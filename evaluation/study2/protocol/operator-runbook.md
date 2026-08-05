# Operator runbook

1. Confirm the Study Profile, extension commit, task image digest, manifest
   hashes, model identifier, and public-test command before the first session.
2. Generate the participant's assignment. Do not improvise task or condition
   allocation during a session.
3. Create a new run directory and participant workspace from the appropriate
   task mutation. Confirm that no prior `.contextbranch/` directory exists.
4. Start the assigned period. The operator may fix an environment failure but
   must not explain code, direct an implementation route, or suggest prompts.
5. At `Finish task` or timeout, capture the final main-state patch, export
   telemetry, and start a new clean workspace for the next period.
6. After the session, invoke the clean private grader. Store participant ID
   mappings and recordings separately from pseudonymous run bundles.
7. Mark an invalid run only for withdrawal, consent withdrawal, or documented
   infrastructure/data-capture failure. Non-use of a state, an incomplete
   feature, or a slow submission remains valid data.

Before main data collection, run all four assignment sequences as technical dry
runs. Each dry run must confirm condition parity, exactly two automatic states,
public-test determinism, final-state capture, clean grading, and complete data
export.
