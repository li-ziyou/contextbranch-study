#!/usr/bin/env python3
"""Grade a submitted final main state without trusting its tests or metadata.

The grader copies only allowlisted production files from a captured submission
onto a fresh private mutation baseline, then runs the hidden behavioural tests
in the prepared Study Python runtime. The output is an audit record, not a score.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path


HERE = Path(__file__).resolve().parent
STUDY_ROOT = HERE.parent
RUNNER = STUDY_ROOT / "runner" / "study_runner.py"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def copy_file(source: Path, destination: Path) -> None:
    if source.is_symlink():
        raise RuntimeError(f"Refusing symlink in submission: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def materialize_clean_submission(bundle: Path, submission: Path, destination: Path) -> tuple[dict, list[str]]:
    private = bundle / "private"
    mutation = private / "mutation"
    config = read_json(private / "grading.json")
    if not mutation.is_dir():
        raise RuntimeError(f"Missing clean mutation baseline: {mutation}")
    if not submission.is_dir():
        raise RuntimeError(f"Submission is not a directory: {submission}")
    shutil.copytree(mutation, destination, symlinks=False)
    copied: list[str] = []
    for relative in config["allowedProductionPaths"]:
        source = submission / relative
        if not source.is_file():
            raise RuntimeError(f"Submission did not contain required production path: {relative}")
        copy_file(source, destination / relative)
        copied.append(relative)
    return config, copied


def run_checks(
    clean_root: Path,
    private_root: Path,
    timeout: int,
    tests: Path | None = None,
    form_id: str = "F1",
) -> tuple[int, str]:
    command = [
        sys.executable,
        str(RUNNER),
        "--timeout",
        str(timeout),
        "private",
        "--clean-root",
        str(clean_root),
        "--private-root",
        str(private_root),
    ]
    if tests:
        command.extend(["--tests", str(tests)])
    environment = dict(os.environ)
    runtime_python = STUDY_ROOT.parents[1] / ".study-runtime" / "bin" / "python"
    if runtime_python.is_file():
        environment["CONTEXTBRANCH_STUDY_PYTHON"] = str(runtime_python)
    environment["CONTEXTBRANCH_STUDY_FORM_ID"] = form_id
    completed = subprocess.run(command, text=True, capture_output=True, env=environment)
    return completed.returncode, completed.stdout + completed.stderr


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True, help="Built task bundle directory")
    parser.add_argument("--submission", type=Path, required=True, help="Captured final main workspace")
    parser.add_argument("--result", type=Path, required=True, help="Where to write the JSON audit record")
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="contextbranch-clean-grade-") as temporary:
        clean_root = Path(temporary) / "workspace"
        try:
            run_metadata_path = args.submission / ".study" / "run.json"
            run_metadata = read_json(run_metadata_path) if run_metadata_path.is_file() else {}
            form_id = str(run_metadata.get("formId") or "F1")
            config, copied = materialize_clean_submission(args.bundle, args.submission, clean_root)
            private_root = args.bundle / "private"
            goal_results = {}
            combined_output: list[str] = []
            for goal, filename in zip(config["hiddenGoals"], config["hiddenTestFiles"], strict=True):
                status, output = run_checks(
                    clean_root,
                    private_root,
                    args.timeout,
                    private_root / "hidden_tests" / filename,
                    form_id,
                )
                goal_results[goal] = {
                    "verified": status == 0,
                    "runnerExitCode": status,
                    "runnerOutput": output,
                }
                combined_output.append(f"[{goal}]\n{output}")
            status = 0 if all(item["verified"] for item in goal_results.values()) else 1
            result = {
                "taskId": config["taskId"],
                "formId": form_id,
                "gradedAt": datetime.now(timezone.utc).isoformat(),
                "cleanPatch": {"status": "applied", "allowedProductionPaths": copied},
                "hiddenGoals": config["hiddenGoals"],
                "goalResults": goal_results,
                "verifiedFeatureDelivery": status == 0,
                "runnerExitCode": status,
                "runnerOutput": "\n".join(combined_output),
            }
        except Exception as error:
            result = {
                "gradedAt": datetime.now(timezone.utc).isoformat(),
                "cleanPatch": {"status": "not-applied", "reason": str(error)},
                "verifiedFeatureDelivery": False,
            }
    args.result.parent.mkdir(parents=True, exist_ok=True)
    args.result.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return 0 if result.get("verifiedFeatureDelivery") else 1


if __name__ == "__main__":
    raise SystemExit(main())
