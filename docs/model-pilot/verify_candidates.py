"""Check candidate assertions against alternative implementations and defects."""
import argparse
import json
from pathlib import Path

from audit_tests import candidate_tests, execute


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study", type=Path, required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    task = "exception-group-matcher"
    bundle = args.study / "participant-bundles" / task
    allowed = json.loads((bundle / "private/grading.json").read_text())["allowedProductionPaths"]
    tests = {f"{label}/{file.name}": file.read_text()
             for label, folder in (("public", "participant/tests"), ("private", "private/hidden_tests"))
             for file in (bundle / folder).glob("*.py")}
    variants = {"original": tests, "candidate": candidate_tests(task, tests)}
    controls = {
        "short_circuit_success": ("exception_matcher/groups.py", '''
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
        "extra_predicate_evaluation": ("exception_matcher/leaf.py", '''
_original_match = LeafMatcher.match
def _evaluate_again(self, actual):
    result = _original_match(self, actual)
    if self.predicate and result.matched:
        self.predicate(actual)
    return result
LeafMatcher.match = _evaluate_again
'''),
        "diagnostic_context": ("exception_matcher/groups.py", '''
from dataclasses import replace
_original_match = GroupMatcher.match
def _explain(self, actual):
    result = _original_match(self, actual)
    return replace(result, evidence=tuple(replace(item, message="Matcher: " + item.message) for item in result.evidence))
GroupMatcher.match = _explain
'''),
        "wrong_unwrapped_code": ("exception_matcher/groups.py", '''
_original_match = GroupMatcher.match
def _wrong_code(self, actual):
    if not isinstance(actual, BaseExceptionGroup) and not (self.allow_unwrapped and len(self.expected) == 1):
        return MatchResult.failure(MatchEvidence(FailureCode.TYPE_MISMATCH, "Wrong category"))
    return _original_match(self, actual)
GroupMatcher.match = _wrong_code
'''),
        "always_alternative": ("exception_matcher/groups.py", '''
from dataclasses import replace
_original_match = GroupMatcher.match
def _always_alternative(self, actual):
    result = _original_match(self, actual)
    if not result.matched:
        return replace(result, possible_alternative_pairing=True)
    return result
GroupMatcher.match = _always_alternative
'''),
    }
    rows = []
    for form in ("F1", "F2"):
        for control, (file, patch) in controls.items():
            files = {name: (bundle / "private/reference" / name).read_text() for name in allowed}
            files[file] += "\n" + patch
            for variant, suite in variants.items():
                result = execute(args.study, args.python, task, form, files, suite)
                expected = variant == "candidate" and control not in ("wrong_unwrapped_code", "always_alternative")
                assert bool(result["cases"]) and (result["exit"] == 0) == expected, (control, variant, result)
                rows.append({"form": form, "control": control, "variant": variant,
                             "exit": result["exit"], "failed": [name for name, status in result["cases"].items() if status != "passed"]})
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(rows, indent=2) + "\n")
    print(f"Verified {len(rows)} alternative-implementation and defect controls.")


if __name__ == "__main__":
    main()
