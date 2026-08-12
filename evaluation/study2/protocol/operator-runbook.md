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
   model, time limit, and pooled budgets. It also creates a fresh participant
   session folder named `P017_YYYYMMDDTHHMMSSZ`. Period 2 for that participant
   is created in the same session folder. Open only the printed workspace.
4. The participant opens `.study/TASK.md`, then uses Start task, Run public
   tests, state switching/integration where available, and Finish task. The
   operator may repair an environment failure but must not explain code, direct
   an implementation route, or suggest prompts.
5. At Finish task or timeout, the extension fixes the final main state and
   automatically writes one ZIP to `<participant session folder>/participant-exports/`. Its
   name is `PARTICIPANT_TASK_CONDITION_PERIOD.zip`, for example
   `P017_rgb-image-composer_contextbranch_2.zip`. The ZIP contains the final
   allowlisted production files, completion record, task ticket, and the full
   ContextBranch conversation/state/telemetry store. It excludes API keys,
   `.git`, private tests, and the private grader. Prepare a new clean workspace
   for period 2.
6. After the session, obtain both participant ZIPs and invoke the clean private
   grader on each extracted `submission/main` directory. Store participant ID
   mappings, workload forms, interviews, and recordings separately from the
   pseudonymous ZIPs.
7. Mark an invalid run only for withdrawal, consent withdrawal, or documented
   infrastructure/data-capture failure. Non-use of a state, an incomplete
   feature, or a slow submission remains valid data.

Before main data collection, run all four assignment sequences as technical dry
runs. Each dry run must confirm condition parity, exactly two automatic states,
public-test determinism, final-state capture, clean grading, and complete data
export.
