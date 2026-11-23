"""Audit original task tests and candidate checks in disposable workspaces."""

import argparse
import ast
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def candidate_tests(task, tests):
    result = dict(tests)
    if task == "tree-node-navigation":
        name = "private/test_structure_integrity.py"
        substitutions = {
            'existing, candidate = root.resolve(occupied), Node()':
                'existing, candidate = root.children[occupied], Node()',
            'moving, leaf = first.resolve("moving"), first.resolve("moving/leaf")':
                'moving, leaf = first.children["moving"], first.children["moving"].children["leaf"]',
            'source, new_leaf = root.resolve("source"), root.resolve("source/new_leaf")':
                'source, new_leaf = root.children["source"], root.children["source"].children["new_leaf"]',
            'child = root.resolve("child")': 'child = root.children["child"]',
        }
        original = result[name]
        for old, new in substitutions.items():
            assert result[name].count(old) == 1
            result[name] = result[name].replace(old, new)
        checks = lambda source: [ast.dump(node) for node in ast.walk(ast.parse(source))
                                 if isinstance(node, (ast.Assert, ast.With))]
        assert checks(original) == checks(result[name])
    else:
        changes = {
            "private/test_matcher_integration.py": {
                'assert len(seen) == 1 and str(seen[0]) == accepted':
                    'assert seen and all(str(item) == accepted for item in seen)',
                'assert [str(item) for item in left_seen] == ["right", "left"]':
                    'assert any(str(item) == "left" for item in left_seen)',
                'assert [str(item) for item in right_seen] == ["right", "left"]':
                    'assert any(str(item) == "right" for item in right_seen)',
                'assert result.evidence == (MatchEvidence(FailureCode.PREDICATE_REJECTED, "recorded mismatch"),)':
                    'assert not result.matched\n    assert tuple((item.code, item.expected_index, item.actual_index, item.actual_path) for item in result.evidence) == ((FailureCode.PREDICATE_REJECTED, None, None, ()),)',
            },
            "private/test_leaf_matching.py": {
                'assert len(seen) == 2':
                    'assert any(error.args == ("ok",) for error in seen)\n    assert any(error.args == ("not ok",) for error in seen)',
            },
        }
        for name, substitutions in changes.items():
            for old, new in substitutions.items():
                assert result[name].count(old) == 1
                result[name] = result[name].replace(old, new)
    return result


def execute(study, python, task, form, files, tests):
    bundle = study / "participant-bundles" / task
    with tempfile.TemporaryDirectory(prefix="gitchat-test-audit-") as directory:
        root = Path(directory)
        shutil.copytree(bundle / "private/mutation", root, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
        for name, text in files.items():
            (root / name).write_text(text)
        for name, text in tests.items():
            target = root / "audit" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
        env = {**os.environ, "PYTHONPATH": str(root), "PYTHONDONTWRITEBYTECODE": "1",
               "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1", "CONTEXTBRANCH_STUDY_FORM_ID": form}
        command = [str(python), "-m", "pytest", "-q", "-p", "no:cacheprovider",
                   "--junitxml=result.xml", "audit/public", "audit/private"]
        try:
            run = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True, timeout=12)
        except subprocess.TimeoutExpired:
            return {"exit": 124, "cases": {}, "failures": {}}
        xml = root / "result.xml"
        cases, failures = {}, {}
        if xml.exists():
            for node in ET.parse(xml).iter("testcase"):
                key = node.attrib.get("classname", "") + "::" + node.attrib["name"]
                failure = next((item for item in node if item.tag in ("failure", "error")), None)
                cases[key] = "passed" if failure is None else failure.tag
                if failure is not None:
                    text = failure.text or ""
                    if "NotImplementedError" in text:
                        failures[key] = "unimplemented"
                    elif "SyntaxError" in text or "IndentationError" in text:
                        failures[key] = "syntax"
                    elif "AttributeError" in text or "NameError" in text:
                        failures[key] = "missing_api_or_name"
                    elif "AssertionError" in text:
                        failures[key] = "assertion"
                    else:
                        failures[key] = "other"
        return {"exit": run.returncode, "cases": cases, "failures": failures}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    tasks = ("tree-node-navigation", "exception-group-matcher")
    tests, allowed = {}, {}
    original_hashes = {}
    for task in tasks:
        bundle = args.study / "participant-bundles" / task
        allowed[task] = json.loads((bundle / "private/grading.json").read_text())["allowedProductionPaths"]
        original = {}
        for prefix, folder in (("public", "participant/tests"), ("private", "private/hidden_tests")):
            for path in sorted((bundle / folder).glob("*.py")):
                original[f"{prefix}/{path.name}"] = path.read_text()
                original_hashes[str(path)] = digest(path)
        tests[task] = {"original": original, "candidate": candidate_tests(task, original)}
        diff = "".join("".join(difflib.unified_diff(original[name].splitlines(True),
                       tests[task]["candidate"][name].splitlines(True),
                       fromfile=f"original/{name}", tofile=f"candidate/{name}")) for name in original)
        (args.out / f"{task}.diff").write_text(diff)
    sessions = json.loads((args.analysis / "2026-09-18-results-rerun/derived/sessions.json").read_text())
    for item in json.loads((args.analysis / "2026-09-28-latest-p033-p034/inventory.json").read_text()):
        archive = Path(item["archive"])
        run = json.loads((archive / "run.json").read_text())
        sessions.append({"participant": item["participant"], "period": item["period"],
                         "condition": run["condition"], "task": run["taskId"], "form": run["formId"],
                         "submission": str(archive / "submission" / "main")})
    assert len(sessions) == 72
    jobs = []
    for session in sessions:
        files = {}
        for name in allowed[session["task"]]:
            path = Path(session["submission"]) / name
            original_hashes[str(path)] = digest(path)
            expected = session.get("current_input_hashes", {}).get(name)
            if expected:
                assert digest(path) == expected
            files[name] = path.read_text()
        for variant in ("original", "candidate"):
            jobs.append((session, files, variant))

    def replay(job):
        session, files, variant = job
        result = execute(args.study, args.python, session["task"], session["form"], files,
                         tests[session["task"]][variant])
        return session, variant, result

    controls = []
    for task in tasks:
        bundle = args.study / "participant-bundles" / task / "private"
        for form in ("F1", "F2"):
            for implementation in ("reference", "mutation", "A_only", "B_only"):
                files = {name: (bundle / ("reference" if implementation == "reference" or
                         implementation == ("A_only" if index == 0 else "B_only") else "mutation") / name).read_text()
                         for index, name in enumerate(allowed[task])}
                for variant in ("original", "candidate"):
                    result = execute(args.study, args.python, task, form, files, tests[task][variant])
                    controls.append({"task": task, "form": form, "implementation": implementation,
                                     "variant": variant, **result})
                    assert result["cases"] and result["exit"] in (0, 1)
                    assert (result["exit"] == 0) == (implementation == "reference")
    with ThreadPoolExecutor(max_workers=5) as pool:
        outcomes = list(pool.map(replay, jobs))
    paired = defaultdict(dict)
    for session, variant, result in outcomes:
        paired[(session["participant"], session["period"])][variant] = result
    tallies = defaultdict(Counter)
    causes = defaultdict(Counter)
    for session, variant, result in outcomes:
        prefix = (session["task"], session["condition"], variant)
        for name, status in result["cases"].items():
            tallies[prefix + (name,)][status] += 1
        for name, cause in result["failures"].items():
            causes[prefix + (name,)][cause] += 1
    improved, regressed, missing = Counter(), Counter(), Counter()
    for session in sessions:
        pair = paired[(session["participant"], session["period"])]
        for name, status in pair["original"]["cases"].items():
            new = pair["candidate"]["cases"].get(name)
            key = session["task"] + "/" + name
            if new is None:
                missing[key] += 1
            elif status != "passed" and new == "passed":
                improved[key] += 1
            elif status == "passed" and new != "passed":
                regressed[key] += 1
    assert all(digest(Path(path)) == value for path, value in original_hashes.items())
    summary = {"sessions": len(sessions), "participant_suite_runs": len(outcomes),
               "control_suite_runs": len(controls), "source_hashes_verified": len(original_hashes),
               "participant_exit_codes": dict(Counter(result["exit"] for _, _, result in outcomes)),
               "new_passes": dict(improved), "regressions": dict(regressed),
               "missing_candidate_cases": dict(missing),
               "per_case": [{"task": key[0], "condition": key[1], "variant": key[2],
                             "case": key[3], "outcomes": dict(value), "failure_causes": dict(causes[key])}
                            for key, value in sorted(tallies.items())], "controls": controls}
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key: value for key, value in summary.items() if key not in ("per_case", "controls")}, indent=2))


if __name__ == "__main__":
    main()
