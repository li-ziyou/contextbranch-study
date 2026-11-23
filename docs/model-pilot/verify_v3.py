"""Validate the candidate with independent branches and discriminating defects."""
import argparse
import hashlib
import json
from pathlib import Path

from audit_tests import execute
from candidate_v3 import minimal_tests, proposed_tests, read_tests, save_diff


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    rows, hashes = [], {}
    tasks = ("tree-node-navigation", "exception-group-matcher")
    for task in tasks:
        bundle = args.study / "participant-bundles" / task
        allowed = json.loads((bundle / "private/grading.json").read_text())["allowedProductionPaths"]
        originals = read_tests(args.study, task)
        variants = {"original": originals, "minimal": minimal_tests(task, originals),
                    "proposed": proposed_tests(task, originals)}
        save_diff(args.out, task, originals, variants["proposed"])
        for file in bundle.rglob("*.py"):
            hashes[file] = hashlib.sha256(file.read_bytes()).hexdigest()
        reference = {name: (bundle / "private/reference" / name).read_text() for name in allowed}
        mutation = {name: (bundle / "private/mutation" / name).read_text() for name in allowed}

        def run(label, form, variant, files, side=None, expected=True):
            suite = variants[variant]
            if side:
                private = {"tree-node-navigation": {"A": "structure_integrity", "B": "path_navigation"},
                           "exception-group-matcher": {"A": "leaf_matching", "B": "group_matching"}}[task][side]
                selected = {f"public/test_responsibility_{side.lower()}.py", f"private/test_{private}.py"}
                suite = {name: value for name, value in suite.items()
                         if name in selected or name.endswith("conftest.py")}
            result = execute(args.study, args.python, task, form, files, suite)
            assert result["cases"] and result["exit"] in (0, 1), (task, label, result)
            assert (result["exit"] == 0) == expected, (task, label, form, variant, result)
            rows.append({"task": task, "control": label, "form": form, "variant": variant,
                         "side": side, "exit": result["exit"], "cases": len(result["cases"]),
                         "failed": [name for name, status in result["cases"].items() if status != "passed"]})

        for form in ("F1", "F2"):
            for variant in variants:
                run("reference", form, variant, reference)
                run("baseline", form, variant, mutation, expected=False)
                for index, side in enumerate(("A", "B")):
                    partial = dict(mutation)
                    partial[allowed[index]] = reference[allowed[index]]
                    run("independent_branch", form, variant, partial, side,
                        expected=not (task == "tree-node-navigation" and side == "A" and variant == "original"))

            if task == "tree-node-navigation":
                files = dict(reference)
                files[allowed[1]] += "\ndef remove(node, path):\n    raise NotImplementedError('remove not implemented')\n"
                # Compare only public B checks to demonstrate the previous local-feedback gap.
                for variant in ("original", "proposed"):
                    suite = {name: value for name, value in variants[variant].items()
                             if name == "public/test_responsibility_b.py" or name.endswith("conftest.py")}
                    result = execute(args.study, args.python, task, form, files, suite)
                    assert (result["exit"] == 0) == (variant == "original"), result
                    rows.append({"task": task, "control": "remove_unimplemented_public_B", "form": form,
                                 "variant": variant, "exit": result["exit"], "cases": len(result["cases"]),
                                 "failed": [name for name, status in result["cases"].items() if status != "passed"]})
            else:
                controls = {
                    "success_with_failure_evidence": (allowed[0], '''
from dataclasses import replace
from .contracts import FailureCode, MatchEvidence
_original_match = LeafMatcher.match
def _dirty_success(self, actual):
    result = _original_match(self, actual)
    return replace(result, evidence=(MatchEvidence(FailureCode.TYPE_MISMATCH, "wrong success evidence"),)) if result.matched else result
LeafMatcher.match = _dirty_success
'''),
                    "always_alternative": (allowed[1], '''
from dataclasses import replace
_original_match = GroupMatcher.match
def _always_alternative(self, actual):
    result = _original_match(self, actual)
    return replace(result, possible_alternative_pairing=True) if not result.matched else result
GroupMatcher.match = _always_alternative
'''),
                    "short_circuit_success": (allowed[1], '''
_original_match = GroupMatcher.match
def _short_match(self, actual):
    if isinstance(actual, BaseExceptionGroup):
        items = _actual_items(actual, self.flatten)
        used = set()
        for matcher in self.expected:
            for index, (error, _) in enumerate(items):
                if index not in used and matcher.match(error).matched:
                    used.add(index)
                    break
            else:
                return _original_match(self, actual)
        if len(used) == len(items):
            return MatchResult.success()
    return _original_match(self, actual)
GroupMatcher.match = _short_match
'''),
                    "extra_predicate_call": (allowed[0], '''
_original_match = LeafMatcher.match
def _again(self, actual):
    result = _original_match(self, actual)
    if self.predicate and result.matched:
        self.predicate(actual)
    return result
LeafMatcher.match = _again
'''),
                }
                for control, (file, patch) in controls.items():
                    files = dict(reference)
                    files[file] += "\n" + patch
                    for variant in variants:
                        expected = ((control == "success_with_failure_evidence" and variant != "proposed") or
                                    (control == "short_circuit_success" and variant != "original"))
                        run(control, form, variant, files, expected=expected)
        assert all(hashlib.sha256(file.read_bytes()).hexdigest() == value for file, value in hashes.items())
    result = {"source_files_unchanged": len(hashes), "verified_runs": len(rows), "runs": rows}
    (args.out / "verification.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"Verified {len(rows)} suite outcomes; {len(hashes)} source file hashes unchanged.")


if __name__ == "__main__":
    main()
