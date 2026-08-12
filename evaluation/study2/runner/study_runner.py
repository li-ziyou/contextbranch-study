#!/usr/bin/env python3
"""Run public or private Study 2 tests in the prepared local Python runtime."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def runtime_python(workspace: Path) -> str:
    # Operator/rehearsal override remains useful, but prepared participant
    # workspaces also carry the absolute runtime path generated on the current
    # machine. This avoids guessing from /tmp.
    configured = os.environ.get("CONTEXTBRANCH_STUDY_PYTHON")
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file():
            return str(candidate)

    run_path = workspace / ".study" / "run.json"
    try:
        run = read_json(run_path)
        configured_run = run.get("runtimePython")
        if configured_run:
            candidate = Path(configured_run).expanduser()
            if candidate.is_file():
                return str(candidate)
    except (OSError, ValueError, TypeError):
        pass

    resolved_workspace = workspace.resolve()
    for parent in [resolved_workspace, *resolved_workspace.parents]:
        candidate = parent / ".study-runtime" / "bin" / "python"
        if candidate.is_file():
            return str(candidate)

    # Last-resort fallback preserves the old behavior, but the operator
    # preflight/prepare path should normally make this unnecessary.
    return sys.executable


def run(source: Path, tests: Path, timeout: int) -> int:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(source.resolve()) + os.pathsep + env.get("PYTHONPATH", "")
    try:
        return subprocess.run(
            [runtime_python(source), "-m", "pytest", str(tests.resolve()), "-q", "-p", "no:cacheprovider"],
            cwd=source,
            env=env,
            timeout=timeout,
        ).returncode
    except subprocess.TimeoutExpired:
        print(f"Test command exceeded {timeout} seconds.", file=sys.stderr)
        return 124


def public(workspace: Path, timeout: int) -> int:
    task = read_json(workspace / ".study" / "task.json")
    return run(workspace, workspace / ".study" / "public_tests", timeout)


def private(clean_root: Path, private_root: Path, timeout: int, tests: Path | None) -> int:
    config = read_json(private_root / "grading.json")
    selected_tests = tests or private_root / "hidden_tests"
    return run(clean_root, selected_tests, timeout)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="mode", required=True)
    public_parser = subparsers.add_parser("public")
    public_parser.add_argument("--workspace", type=Path, required=True)
    private_parser = subparsers.add_parser("private")
    private_parser.add_argument("--clean-root", type=Path, required=True)
    private_parser.add_argument("--private-root", type=Path, required=True)
    private_parser.add_argument("--tests", type=Path)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()
    if args.mode == "public":
        return public(args.workspace, args.timeout)
    return private(args.clean_root, args.private_root, args.timeout, args.tests)


if __name__ == "__main__":
    raise SystemExit(main())
