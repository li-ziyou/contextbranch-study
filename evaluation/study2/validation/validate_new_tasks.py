#!/usr/bin/env python3
"""Run frozen baseline, responsibility, reference, alternative, and mutant checks."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
STUDY = ROOT / "evaluation" / "study2"
PYTHON = ROOT / ".study-runtime" / "bin" / "python"


def overlay(source: Path, destination: Path) -> None:
    for file in source.rglob("*.py"):
        target = destination / file.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)


def run_tests(workspace: Path, tests: Path) -> dict:
    environment = {**os.environ, "PYTHONPATH": str(workspace)}
    result = subprocess.run(
        [str(PYTHON), "-m", "pytest", str(tests), "-q", "-p", "no:cacheprovider"],
        cwd=workspace,
        env=environment,
        text=True,
        capture_output=True,
    )
    return {"passed": result.returncode == 0, "exitCode": result.returncode, "summary": (result.stdout + result.stderr).strip().splitlines()[-1]}


def rewrite(file: Path, old: str, new: str) -> None:
    source = file.read_text(encoding="utf-8")
    if old not in source:
        raise RuntimeError(f"Validation transformation no longer applies: {file}: {old!r}")
    file.write_text(source.replace(old, new), encoding="utf-8")


def tree_alternative(workspace: Path, number: int) -> None:
    structure = workspace / "branching_tree" / "structure.py"
    navigation = workspace / "branching_tree" / "navigation.py"
    if number == 1:
        rewrite(structure, "_validate_name", "_check_child_name")
        rewrite(navigation, "_root", "_tree_root")
        rewrite(navigation, "result.extend(descendants(child))", "result += list(descendants(child))")
        return
    recursive = '''def descendants(node: Node) -> tuple[Node, ...]:
    result: list[Node] = []
    for child in node._children.values():
        result.append(child)
        result.extend(descendants(child))
    return tuple(result)
'''
    iterative = '''def descendants(node: Node) -> tuple[Node, ...]:
    result: list[Node] = []
    pending = list(reversed(tuple(node._children.values())))
    while pending:
        child = pending.pop()
        result.append(child)
        pending.extend(reversed(tuple(child._children.values())))
    return tuple(result)
'''
    rewrite(navigation, recursive, iterative)
    recursive_leaves = '''def leaves(node: Node) -> tuple[Node, ...]:
    if not node._children:
        return (node,)
    return tuple(leaf for child in node._children.values() for leaf in leaves(child))
'''
    iterative_leaves = '''def leaves(node: Node) -> tuple[Node, ...]:
    found: list[Node] = []
    pending = [node]
    while pending:
        current = pending.pop()
        if current._children:
            pending.extend(reversed(tuple(current._children.values())))
        else:
            found.append(current)
    return tuple(found)
'''
    rewrite(navigation, recursive_leaves, iterative_leaves)


def exception_alternative(workspace: Path, number: int) -> None:
    groups = workspace / "exception_matcher" / "groups.py"
    if number == 1:
        rewrite(groups, "_actual_items", "_collect_actual_items")
        rewrite(groups, "_has_complete_pairing", "_complete_pairing_exists")
        return
    recursive = '''def _actual_items(group: BaseExceptionGroup, flatten: bool) -> tuple[tuple[BaseException, tuple[int, ...]], ...]:
    items: list[tuple[BaseException, tuple[int, ...]]] = []

    def visit(current: BaseExceptionGroup, prefix: tuple[int, ...]) -> None:
        for index, exception in enumerate(current.exceptions):
            path = prefix + (index,)
            if flatten and isinstance(exception, BaseExceptionGroup):
                visit(exception, path)
            else:
                items.append((exception, path))

    visit(group, ())
    return tuple(items)
'''
    iterative = '''def _actual_items(group: BaseExceptionGroup, flatten: bool) -> tuple[tuple[BaseException, tuple[int, ...]], ...]:
    items: list[tuple[BaseException, tuple[int, ...]]] = []
    pending = [(exception, (index,)) for index, exception in reversed(tuple(enumerate(group.exceptions)))]
    while pending:
        exception, path = pending.pop()
        if flatten and isinstance(exception, BaseExceptionGroup):
            pending.extend((child, path + (index,)) for index, child in reversed(tuple(enumerate(exception.exceptions))))
        else:
            items.append((exception, path))
    return tuple(items)
'''
    rewrite(groups, recursive, iterative)


TASKS = {
    "tree-node-navigation": {
        "a_file": "branching_tree/structure.py",
        "b_file": "branching_tree/navigation.py",
        "a_public": "test_responsibility_a.py",
        "b_public": "test_responsibility_b.py",
        "integration_public": "test_integration.py",
        "alternative": tree_alternative,
        "mutants": {
            "TN-M1": ("branching_tree/structure.py", "if cursor is child:", "if False and cursor is child:", "test_structure_integrity.py"),
            "TN-M2": ("branching_tree/structure.py", "del child._parent._children[child._name]", "pass  # mutant leaves the old child entry", "test_tree_integration.py"),
            "TN-M3": ("branching_tree/navigation.py", "current = _root(node) if path.is_absolute() else node", "current = node", "test_path_navigation.py"),
            "TN-M4": ("branching_tree/navigation.py", "result.extend(descendants(child))", "result.extend(child._children.values())", "test_path_navigation.py"),
        },
    },
    "exception-group-matcher": {
        "a_file": "exception_matcher/leaf.py",
        "b_file": "exception_matcher/groups.py",
        "a_public": "test_responsibility_a.py",
        "b_public": "test_responsibility_b.py",
        "integration_public": "test_integration.py",
        "alternative": exception_alternative,
        "mutants": {
            "EG-M1": ("exception_matcher/leaf.py", "if not isinstance(actual, self.exception_type):", "if type(actual) is not self.exception_type:", "test_leaf_matching.py"),
            "EG-M2": ("exception_matcher/leaf.py", "self.message.search(text)", "self.message.fullmatch(text)", "test_leaf_matching.py"),
            "EG-M3": ("exception_matcher/groups.py", "if flatten and isinstance(exception, BaseExceptionGroup):", "if flatten and isinstance(exception, BaseExceptionGroup) and not prefix:", "test_group_matching.py"),
            "EG-M4": ("exception_matcher/groups.py", "if not unmatched_expected and len(used) == len(actual_items):", "if not unmatched_expected:", "test_group_matching.py"),
            "EG-M5": ("exception_matcher/contracts.py", "actual_path=prefix + self.actual_path", "actual_path=self.actual_path", "test_matcher_integration.py"),
        },
    },
}


def materialize(task_id: str, reference_files: tuple[str, ...] = ()) -> tuple[tempfile.TemporaryDirectory, Path]:
    temporary = tempfile.TemporaryDirectory(prefix=f"study2-validate-{task_id}-")
    workspace = Path(temporary.name) / "workspace"
    baseline = STUDY / "task-assets" / task_id / "baseline"
    shutil.copytree(baseline, workspace)
    reference = STUDY / "task-assets" / task_id / "reference"
    for relative in reference_files:
        target = workspace / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(reference / relative, target)
    return temporary, workspace


def validate_task(task_id: str, config: dict) -> dict:
    public = STUDY / "public-tests" / task_id
    private = STUDY / "private-grader" / "checks" / task_id
    report: dict = {}
    for label, files in {
        "incomplete": (),
        "aOnly": (config["a_file"],),
        "bOnly": (config["b_file"],),
        "reference": (config["a_file"], config["b_file"]),
    }.items():
        temporary, workspace = materialize(task_id, files)
        try:
            report[label] = {
                "aPublic": run_tests(workspace, public / config["a_public"]),
                "bPublic": run_tests(workspace, public / config["b_public"]),
                "integrationPublic": run_tests(workspace, public / config["integration_public"]),
                "private": run_tests(workspace, private),
            }
        finally:
            temporary.cleanup()

    report["alternatives"] = {}
    for number in (1, 2):
        temporary, workspace = materialize(task_id, (config["a_file"], config["b_file"]))
        try:
            config["alternative"](workspace, number)
            report["alternatives"][f"alternative{number}"] = {
                "public": run_tests(workspace, public),
                "private": run_tests(workspace, private),
            }
        finally:
            temporary.cleanup()

    report["mutants"] = {}
    for mutant_id, (relative, old, new, detecting_file) in config["mutants"].items():
        temporary, workspace = materialize(task_id, (config["a_file"], config["b_file"]))
        try:
            rewrite(workspace / relative, old, new)
            result = run_tests(workspace, private / detecting_file)
            report["mutants"][mutant_id] = {**result, "killed": not result["passed"], "detectingFile": detecting_file}
        finally:
            temporary.cleanup()
    return report


def main() -> int:
    if not PYTHON.is_file():
        raise SystemExit(f"Missing study runtime: {PYTHON}")
    report = {task_id: validate_task(task_id, config) for task_id, config in TASKS.items()}
    output = STUDY / "research" / "validation-results.json"
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    expected = []
    for task in report.values():
        expected.extend([
            not task["incomplete"]["aPublic"]["passed"],
            not task["incomplete"]["bPublic"]["passed"],
            task["aOnly"]["aPublic"]["passed"],
            not task["aOnly"]["integrationPublic"]["passed"],
            task["bOnly"]["bPublic"]["passed"],
            not task["bOnly"]["integrationPublic"]["passed"],
            task["reference"]["private"]["passed"],
            *(item["public"]["passed"] and item["private"]["passed"] for item in task["alternatives"].values()),
            *(item["killed"] for item in task["mutants"].values()),
        ])
    return 0 if all(expected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
