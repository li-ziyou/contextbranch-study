#!/usr/bin/env python3
"""Build selected curated, FeatureBench-derived Study 2 task bundles.

The source tasks preserve the behavioural themes of pinned FeatureBench
instances, but they are study-specific baselines rather than literal upstream
patches. Each baseline has two non-overlapping implementation modules and a
stable composition layer. This gives reintegration a real, deterministic role
without exposing reference repairs or hidden tests to participants.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
STUDY_ROOT = REPO_ROOT / "evaluation" / "study2"
MANIFEST_DIR = STUDY_ROOT / "manifests"
PUBLIC_TESTS = STUDY_ROOT / "public-tests"
PRIVATE_CHECKS = STUDY_ROOT / "private-grader" / "checks"
RUNNER = STUDY_ROOT / "runner" / "study_runner.py"


def command(args: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(
            f"Command failed ({' '.join(args)}):\n{result.stdout}\n{result.stderr}"
        )
    return result.stdout.strip()


def read_manifest(task_id: str) -> dict:
    path = MANIFEST_DIR / f"{task_id}.json"
    if not path.is_file():
        raise ValueError(f"Unknown task {task_id!r}")
    return json.loads(path.read_text(encoding="utf-8"))


def asset_path(manifest: dict, field: str) -> Path:
    relative = manifest["assets"][field]
    candidate = (STUDY_ROOT / relative).resolve()
    assets_root = (STUDY_ROOT / "task-assets").resolve()
    if assets_root not in candidate.parents or not candidate.is_dir():
        raise RuntimeError(f"Task asset {field!r} is missing or outside task-assets: {relative}")
    return candidate


def copy_allowed_files(source: Path, destination: Path, allowed_paths: list[str]) -> None:
    for relative in allowed_paths:
        original = source / relative
        if not original.is_file():
            raise RuntimeError(f"Missing required task file: {original}")
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, target)


def participant_task_card(manifest: dict) -> str:
    main_ticket_file = manifest["ticket"].get("mainTicketFile")
    if main_ticket_file:
        ticket_path = (STUDY_ROOT / main_ticket_file).resolve()
        tasks_root = (STUDY_ROOT / "tasks").resolve()
        if tasks_root not in ticket_path.parents or not ticket_path.is_file():
            raise RuntimeError(f"Main ticket is missing or outside tasks: {main_ticket_file}")
        return ticket_path.read_text(encoding="utf-8")
    ticket = manifest["ticket"]
    requirements = "\n".join(f"- {item}" for item in ticket["requirements"])
    return f"""# {manifest['participantTitle']}

## Ticket

{ticket['summary']}

Implement the requested feature in the supplied repository. You may inspect the
code, ask the coding assistant for help, edit files, and run the public tests.

## Acceptance requirements

{requirements}

Submit the final feature from the main state when you are ready.

Only the supplied public tests are available during the task. The final repair
is checked later on a clean copy of the supplied task baseline.
"""


def public_manifest(manifest: dict) -> dict:
    return {
        "schemaVersion": manifest["schemaVersion"],
        "taskId": manifest["taskId"],
        "participantTitle": manifest["participantTitle"],
        "ticket": manifest["ticket"],
        "runner": manifest["runner"],
        "submission": manifest["submission"],
    }


def private_grading_config(manifest: dict) -> dict:
    goals = manifest["privateGrader"]["hiddenGoals"]
    return {
        "taskId": manifest["taskId"],
        "allowedProductionPaths": manifest["submission"]["allowedProductionPaths"],
        "runtime": manifest["runner"]["runtime"],
        "hiddenGoals": goals,
        "hiddenTestFiles": [f"test_{goal}.py" for goal in goals],
    }


def reset_git_baseline(participant: Path, manifest: dict) -> None:
    command(["git", "init", "--quiet", "--initial-branch=main"], cwd=participant)
    command(["git", "config", "user.name", "ContextBranch Study"], cwd=participant)
    command(["git", "config", "user.email", "study@local.invalid"], cwd=participant)
    command(["git", "add", "-A"], cwd=participant)
    command(["git", "commit", "--quiet", "-m", f"Study baseline: {manifest['taskId']}"], cwd=participant)


def remove_python_caches(root: Path) -> None:
    for cache in root.rglob("__pycache__"):
        shutil.rmtree(cache)
    for bytecode in root.rglob("*.py[co]"):
        bytecode.unlink()


def build_one(manifest: dict, output: Path) -> Path:
    task_root = output / manifest["taskId"]
    if task_root.exists():
        shutil.rmtree(task_root)
    participant = task_root / "participant"
    private = task_root / "private"
    baseline = asset_path(manifest, "baselineDirectory")
    reference = asset_path(manifest, "referenceDirectory")
    allowed = manifest["submission"]["allowedProductionPaths"]

    task_root.mkdir(parents=True)
    shutil.copytree(baseline, participant)
    private.mkdir()

    study_dir = participant / ".study"
    study_dir.mkdir()
    (study_dir / "TASK.md").write_text(participant_task_card(manifest), encoding="utf-8")
    (study_dir / "task.json").write_text(json.dumps(public_manifest(manifest), indent=2) + "\n", encoding="utf-8")
    # Public tests are ordinary participant-facing repository files so the
    # ticket's direct pytest commands and the controlled runner see the same
    # evidence. Clean grading never trusts or copies this directory.
    shutil.copytree(PUBLIC_TESTS / manifest["taskId"], participant / "tests")
    (study_dir / "bin").mkdir()
    shutil.copy2(RUNNER, study_dir / "bin" / "study_runner.py")

    mutation = private / "mutation"
    shutil.copytree(baseline, mutation)
    reference_root = private / "reference"
    reference_root.mkdir()
    copy_allowed_files(reference, reference_root, allowed)
    hidden_dir = private / "hidden_tests"
    shutil.copytree(PRIVATE_CHECKS / manifest["taskId"], hidden_dir)
    (private / "grading.json").write_text(
        json.dumps(private_grading_config(manifest), indent=2) + "\n", encoding="utf-8"
    )
    (private / "provenance.json").write_text(
        json.dumps(manifest["provenance"], indent=2) + "\n", encoding="utf-8"
    )
    remove_python_caches(task_root)
    reset_git_baseline(participant, manifest)
    print(f"Built {task_root}")
    return task_root


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tasks", nargs="+", help="Stable task IDs to build")
    parser.add_argument("--all", action="store_true", help="Build every manifest")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "participant-bundles")
    args = parser.parse_args()
    if args.all == bool(args.tasks):
        parser.error("Use exactly one of --tasks TASK... or --all")
    task_ids = sorted(path.stem for path in MANIFEST_DIR.glob("*.json") if path.name != "task-manifest.schema.json") if args.all else args.tasks
    for task_id in task_ids:
        build_one(read_manifest(task_id), args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
