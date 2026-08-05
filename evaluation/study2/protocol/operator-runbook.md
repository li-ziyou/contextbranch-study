# Operator runbook

1. Run `npm run study:build-tasks`, `npm run study:setup-runtime`, then
   `npm run study:preflight` and `npm run study:dry-run`. Preflight confirms
   the two generated bundles and their isolated Python runtime; dry run checks
   the reference repair through public tests and clean private grading.
2. Record the extension commit, runtime Python and package versions, manifest
   hashes, fixed provider and model identifiers, model-call budget,
   model-token budget, and public-test command in the session log. Configure
   that provider's API key through `ContextBranch: Set API Key` before opening
   a participant workspace.
3. Generate the deterministic assignment and prepare period 1 with
   `npm run study:prepare -- P017 1 --provider FIXED_PROVIDER --model FIXED_MODEL`. Do not improvise task
   or condition allocation during a session. This first command freezes the
   profile in `runs/study-profile.json`; every later run must match its provider,
   model, time limit, and pooled budgets. Open only the printed workspace.
4. The participant opens `.study/TASK.md`, then uses Start task, Run public
   tests, state switching/integration where available, and Finish task. The
   operator may repair an environment failure but must not explain code, direct
   an implementation route, or suggest prompts.
5. At Finish task or timeout, run `npm run study:collect -- RUN_ID`. The
   extension fixes the final main state at completion, and collection checks
   its production-file hashes before it copies the final main workspace and
   ContextBranch telemetry into the run
   directory. Prepare a new clean workspace for period 2.
6. After the session, invoke the clean private grader. Store participant ID
   mappings and recordings separately from pseudonymous run bundles.
7. Mark an invalid run only for withdrawal, consent withdrawal, or documented
   infrastructure/data-capture failure. Non-use of a state, an incomplete
   feature, or a slow submission remains valid data.

Before main data collection, run all four assignment sequences as technical dry
runs. Each dry run must confirm condition parity, exactly two automatic states,
public-test determinism, final-state capture, clean grading, and complete data
export.
