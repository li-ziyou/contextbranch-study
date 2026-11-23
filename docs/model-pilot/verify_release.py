"""Verify built task sources, local responsibilities, clean grading and version guards."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from audit_tests import execute
from candidate_v3 import proposed_tests, read_tests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--historical-study", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.study = args.study.resolve()
    rows = []
    for task in ("tree-node-navigation", "exception-group-matcher"):
        bundle = args.study / "participant-bundles" / task
        config = json.loads((bundle / "private/grading.json").read_text())
        assert config["taskVersion"] == "2026-11-23.1"
        tests = read_tests(args.study, task)
        if args.historical_study:
            expected = proposed_tests(task, read_tests(args.historical_study, task))
            for name, text in tests.items():
                if name.endswith("conftest.py"):
                    # Historical local bundles include runtime compatibility shims.
                    continue
                previous = expected[name]
                if task == "exception-group-matcher" and name == "public/test_integration.py":
                    # Preserve the already merged PR #14 evidence-count correction.
                    previous = previous.replace("assert len(message_failures) == 1", "assert len(message_failures) >= 1")
                assert text == previous, f"Built check differs from reviewed candidate: {task}/{name}"
        allowed = config["allowedProductionPaths"]
        reference = {name: (bundle / "private/reference" / name).read_text() for name in allowed}
        baseline = {name: (bundle / "private/mutation" / name).read_text() for name in allowed}
        for form in ("F1", "F2"):
            for implementation in ("reference", "baseline", "A_only", "B_only"):
                files = dict(baseline)
                if implementation == "reference":
                    files = dict(reference)
                elif implementation.endswith("_only"):
                    index = 0 if implementation == "A_only" else 1
                    files[allowed[index]] = reference[allowed[index]]
                result = execute(args.study, args.python, task, form, files, tests)
                assert result["cases"] and result["exit"] in (0, 1)
                assert (result["exit"] == 0) == (implementation == "reference"), result
                rows.append({"task": task, "form": form, "control": implementation,
                             "exit": result["exit"], "caseCount": len(result["cases"])})
                if implementation.endswith("_only"):
                    side = implementation[0]
                    private_file = {"tree-node-navigation": {"A": "structure_integrity", "B": "path_navigation"},
                                    "exception-group-matcher": {"A": "leaf_matching", "B": "group_matching"}}[task][side]
                    names = {f"public/test_responsibility_{side.lower()}.py", f"private/test_{private_file}.py"}
                    suite = {name: text for name, text in tests.items() if name in names or name.endswith("conftest.py")}
                    local = execute(args.study, args.python, task, form, files, suite)
                    assert local["cases"] and local["exit"] == 0, local
                    rows.append({"task": task, "form": form, "control": f"{side}_independent",
                                 "exit": local["exit"], "caseCount": len(local["cases"])})
            with tempfile.TemporaryDirectory(prefix="gitchat-release-grade-") as directory:
                workspace = Path(directory) / "submission"
                shutil.copytree(bundle / "participant", workspace)
                for name, text in reference.items():
                    (workspace / name).write_text(text)
                (workspace / ".study/run.json").write_text(json.dumps({"formId": form}))
                output = Path(directory) / "grade.json"
                run = subprocess.run([str(args.python), str(args.study / "evaluation/study2/private-grader/grade_submission.py"),
                                      "--bundle", str(bundle), "--submission", str(workspace), "--result", str(output)],
                                     capture_output=True, text=True, timeout=60)
                grade = json.loads(output.read_text())
                assert run.returncode == 0 and grade["verifiedFeatureDelivery"], grade
                assert grade["taskVersion"] == config["taskVersion"]
                rows.append({"task": task, "form": form, "control": "clean_grader_reference",
                             "exit": run.returncode, "taskVersion": grade["taskVersion"]})
        file = args.study / "evaluation/study2/public-tests" / task / "test_responsibility_a.py"
        original = file.read_bytes()
        try:
            file.write_bytes(original + b"\n# changed after freeze\n")
            with tempfile.TemporaryDirectory(prefix="gitchat-release-guard-") as directory:
                run = subprocess.run([str(args.python), str(args.study / "evaluation/study2/task-builder/build_task.py"),
                                      "--tasks", task, "--output", directory], capture_output=True, text=True, timeout=15)
                assert run.returncode != 0 and "Frozen task asset changed" in run.stderr
                rows.append({"task": task, "control": "changed_asset_rejected", "exit": run.returncode})
        finally:
            file.write_bytes(original)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"taskVersion": "2026-11-23.1", "verifiedRuns": len(rows),
                                   "historicalBundleDifferences": ["Runtime conftest compatibility shims are not copied into source", "Merged PR #14 public evidence-count correction is retained"],
                                   "runs": rows}, indent=2) + "\n")
    print(f"Release validation passed: {len(rows)} expected outcomes, including built candidates, independent branches, clean grading and changed-asset rejection.")


if __name__ == "__main__":
    main()
