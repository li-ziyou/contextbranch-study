"""Construct review-only tests without editing frozen study materials."""
import difflib
from pathlib import Path

from audit_tests import candidate_tests as exploratory_candidate

HERE = Path(__file__).resolve().parent


def minimal_tests(task, tests):
    if task == "tree-node-navigation":
        return exploratory_candidate(task, tests)
    result = dict(tests)
    name = "private/test_matcher_integration.py"
    replacements = {
        'assert [str(item) for item in left_seen] == ["right", "left"]':
            'assert any(item is actual.exceptions[1] for item in left_seen)',
        'assert [str(item) for item in right_seen] == ["right", "left"]':
            'assert any(item is actual.exceptions[0].exceptions[0] for item in right_seen)',
    }
    for old, new in replacements.items():
        assert result[name].count(old) == 1
        result[name] = result[name].replace(old, new)
    return result


def proposed_tests(task, tests):
    result = minimal_tests(task, tests)
    for file in (HERE / "candidate_public" / task).glob("test_feedback_*.py"):
        side = file.stem[-1]
        # Appending keeps the existing branch routing and original checks.
        result[f"public/test_responsibility_{side}.py"] += "\n\n" + file.read_text()
    return result


def read_tests(study, task):
    bundle = study / "participant-bundles" / task
    return {f"{label}/{file.name}": file.read_text()
            for label, folder in (("public", "participant/tests"), ("private", "private/hidden_tests"))
            for file in (bundle / folder).glob("*.py")}


def save_diff(out, task, original, proposed):
    folder = out / "proposed-diffs"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{task}.diff").write_text("".join(
        "".join(difflib.unified_diff(original[name].splitlines(True), proposed[name].splitlines(True),
                                    fromfile=f"original/{name}", tofile=f"candidate/{name}"))
        for name in sorted(original)))
