#!/usr/bin/env python3
"""Build the two Study 2 task bundles from pinned FeatureBench instances.

This is an operator-only script. It never puts the FeatureBench patch, its
original F2P test, private checks, or a Git remote in the participant copy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
from typing import Iterable

try:
    import pyarrow.parquet as pq
except ImportError as error:
    raise SystemExit(
        "Missing pyarrow. Create an operator environment and run: "
        "python3 -m pip install -r evaluation/study2/task-builder/requirements.txt"
    ) from error


REPO_ROOT = Path(__file__).resolve().parents[3]
STUDY_ROOT = REPO_ROOT / "evaluation" / "study2"
MANIFEST_DIR = STUDY_ROOT / "manifests"
PUBLIC_TESTS = STUDY_ROOT / "public-tests"
PRIVATE_CHECKS = STUDY_ROOT / "private-grader" / "checks"
RUNNER = STUDY_ROOT / "runner" / "study_runner.py"
RUNTIME_SUPPORT = STUDY_ROOT / "runner" / "runtime-support"


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


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def download_dataset(url: str, cache: Path) -> Path:
    target = cache / "featurebench-full.parquet"
    if target.is_file():
        return target
    cache.mkdir(parents=True, exist_ok=True)
    print("Downloading the FeatureBench data file...")
    with urllib.request.urlopen(url) as response, target.open("wb") as output:
        shutil.copyfileobj(response, output)
    return target


def featurebench_row(manifest: dict, cache: Path) -> dict:
    source = manifest["featureBench"]
    parquet_path = download_dataset(source["datasetUrl"], cache)
    table = pq.read_table(
        parquet_path,
        columns=["instance_id", "patch", "test_patch", "image_name"],
    )
    matches = [row for row in table.to_pylist() if row["instance_id"] == source["instanceId"]]
    if len(matches) != 1:
        raise RuntimeError(f"Expected one FeatureBench row for {source['instanceId']}, found {len(matches)}")
    row = matches[0]
    if sha256(row["patch"]) != source["patchSha256"]:
        raise RuntimeError("FeatureBench production patch does not match its pinned SHA-256")
    if sha256(row["test_patch"]) != source["testPatchSha256"]:
        raise RuntimeError("FeatureBench test patch does not match its pinned SHA-256")
    if row["image_name"] != source["runtimeImageName"]:
        raise RuntimeError("FeatureBench runtime image name does not match the study manifest")
    return row


def checkout_source(manifest: dict, cache: Path) -> Path:
    repository = manifest["source"]["repository"]
    commit = manifest["source"]["commit"]
    target = cache / repository.replace("/", "__")
    if not target.exists():
        print(f"Cloning {repository} at the pinned source revision...")
        command(["git", "clone", "--filter=blob:none", "--no-checkout", f"https://github.com/{repository}.git", str(target)])
    command(["git", "fetch", "--quiet", "origin", commit], cwd=target)
    command(["git", "sparse-checkout", "init", "--no-cone"], cwd=target)
    sparse_paths = [*manifest["source"]["taskSourcePaths"], manifest["featureBench"]["originalTestPath"]]
    command(["git", "sparse-checkout", "set", "--no-cone", *sparse_paths], cwd=target)
    command(["git", "checkout", "--detach", "--force", commit], cwd=target)
    actual = command(["git", "rev-parse", "HEAD"], cwd=target)
    if actual != commit:
        raise RuntimeError(f"Expected source commit {commit}, got {actual}")
    return target


def patch_sections(patch: str) -> Iterable[tuple[str, str]]:
    marker = "diff --git "
    for chunk in patch.split(marker):
        if not chunk.strip():
            continue
        header, _, rest = chunk.partition("\n")
        parts = header.split()
        if len(parts) != 2 or not parts[0].startswith("a/") or not parts[1].startswith("b/"):
            raise RuntimeError(f"Unexpected patch header: {header}")
        old_path = parts[0][2:]
        new_path = parts[1][2:]
        if old_path != new_path:
            raise RuntimeError("Study task mutations may not rename production paths")
        yield old_path, marker + chunk


def filtered_patch(patch: str, allowed_paths: list[str]) -> str:
    sections = [section for file_path, section in patch_sections(patch) if file_path in allowed_paths]
    seen = {file_path for file_path, _ in patch_sections(patch) if file_path in allowed_paths}
    if seen != set(allowed_paths):
        missing = sorted(set(allowed_paths) - seen)
        raise RuntimeError(f"The FeatureBench patch did not touch allowlisted path(s): {missing}")
    return "".join(sections)


def copy_task_slice(source: Path, destination: Path, paths: list[str]) -> None:
    """Create a small participant workspace with only task-relevant code.

    FeatureBench's original runtime image is retained as task provenance, but
    the study executes this constrained task slice in its dedicated local
    runtime. The participant receives only the files they can change plus
    surrounding task material, avoiding a multi-gigabyte study workspace.
    """
    destination.mkdir(parents=True)
    for relative in paths:
        src = source / relative
        if not src.is_file():
            raise RuntimeError(f"Task source file is missing from pinned checkout: {relative}")
        dst = destination / relative
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def apply_mutation(destination: Path, patch: str) -> None:
    patch_file = destination / ".study-mutation.patch"
    patch_file.write_text(patch, encoding="utf-8")
    try:
        command(["git", "init", "--quiet"], cwd=destination)
        command(["git", "apply", "--whitespace=nowarn", str(patch_file)], cwd=destination)
    finally:
        patch_file.unlink(missing_ok=True)
        shutil.rmtree(destination / ".git", ignore_errors=True)


def participant_task_card(manifest: dict) -> str:
    ticket = manifest["ticket"]
    requirements = "\n".join(f"- {item}" for item in ticket["requirements"])
    labels = "\n".join(f"- {item}" for item in manifest["rootBrief"]["implementationIntentLabels"])
    return f"""# {manifest['participantTitle']}

## Ticket

{ticket['summary']}

Implement the requested feature in the supplied repository. You may inspect the
code, ask the coding assistant for help, edit files, and run the public tests.

## Acceptance requirements

{requirements}

## Implementation areas

{labels}

The two implementation areas are shown to everyone. They are suggestions for
organizing work, not required steps. Submit the final feature from the main
state when you are ready.

Only the supplied public tests are available during the task. The final repair
is checked later on a clean copy of the supplied task baseline.
"""


def public_manifest(manifest: dict) -> dict:
    return {
        "schemaVersion": manifest["schemaVersion"],
        "taskId": manifest["taskId"],
        "participantTitle": manifest["participantTitle"],
        "ticket": manifest["ticket"],
        "rootBrief": manifest["rootBrief"],
        "contextBranch": manifest["contextBranch"],
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
        "supplementaryReferenceTest": "reference_tests/test_original_featurebench.py",
    }


def reset_git_baseline(participant: Path, manifest: dict) -> None:
    command(["git", "init", "--quiet", "--initial-branch=main"], cwd=participant)
    command(["git", "config", "user.name", "ContextBranch Study"], cwd=participant)
    command(["git", "config", "user.email", "study@local.invalid"], cwd=participant)
    command(["git", "add", "-A"], cwd=participant)
    command(["git", "commit", "--quiet", "-m", f"Study baseline: {manifest['taskId']}"], cwd=participant)


def build_one(manifest: dict, cache: Path, output: Path) -> Path:
    row = featurebench_row(manifest, cache)
    source = checkout_source(manifest, cache)
    task_root = output / manifest["taskId"]
    if task_root.exists():
        shutil.rmtree(task_root)
    participant = task_root / "participant"
    private = task_root / "private"
    task_root.mkdir(parents=True)

    production_patch = filtered_patch(row["patch"], manifest["submission"]["allowedProductionPaths"])

    copy_task_slice(source, participant, manifest["source"]["taskSourcePaths"])
    apply_mutation(participant, production_patch)
    original_test = source / manifest["featureBench"]["originalTestPath"]
    if not original_test.is_file():
        raise RuntimeError(f"Original FeatureBench test is missing: {original_test}")
    private.mkdir(parents=True)
    reference_tests = private / "reference_tests"
    reference_tests.mkdir()
    shutil.copy2(original_test, reference_tests / "test_original_featurebench.py")

    study_dir = participant / ".study"
    study_dir.mkdir()
    (study_dir / "TASK.md").write_text(participant_task_card(manifest), encoding="utf-8")
    (study_dir / "task.json").write_text(json.dumps(public_manifest(manifest), indent=2) + "\n", encoding="utf-8")
    shutil.copytree(PUBLIC_TESTS / manifest["taskId"], study_dir / "public_tests")
    (study_dir / "bin").mkdir()
    shutil.copy2(RUNNER, study_dir / "bin" / "study_runner.py")
    shutil.copytree(RUNTIME_SUPPORT / manifest["taskId"], participant, dirs_exist_ok=True)

    mutation = private / "mutation"
    copy_task_slice(source, mutation, manifest["source"]["taskSourcePaths"])
    apply_mutation(mutation, production_patch)
    shutil.copytree(RUNTIME_SUPPORT / manifest["taskId"], mutation, dirs_exist_ok=True)
    (private / "reference.patch").write_text(production_patch, encoding="utf-8")
    hidden_dir = private / "hidden_tests"
    shutil.copytree(PRIVATE_CHECKS / manifest["taskId"], hidden_dir)
    (private / "grading.json").write_text(
        json.dumps(private_grading_config(manifest), indent=2) + "\n", encoding="utf-8"
    )
    (private / "provenance.json").write_text(
        json.dumps(
            {
                "featureBenchInstance": manifest["featureBench"]["instanceId"],
                "sourceRepository": manifest["source"]["repository"],
                "sourceCommit": manifest["source"]["commit"],
                "productionPatchSha256": manifest["featureBench"]["patchSha256"],
                "testPatchSha256": manifest["featureBench"]["testPatchSha256"],
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    reset_git_baseline(participant, manifest)
    print(f"Built {task_root}")
    return task_root


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=["markdown-command-template-library", "rgb-image-composer"])
    parser.add_argument("--all", action="store_true", help="Build both task bundles")
    parser.add_argument("--cache", type=Path, default=REPO_ROOT / "task-cache")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "participant-bundles")
    args = parser.parse_args()
    if args.all == bool(args.task):
        parser.error("Use exactly one of --task TASK or --all")
    task_ids = [args.task] if args.task else ["markdown-command-template-library", "rgb-image-composer"]
    for task_id in task_ids:
        build_one(read_manifest(task_id), args.cache, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
