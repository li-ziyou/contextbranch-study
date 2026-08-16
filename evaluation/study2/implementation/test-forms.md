# Study 2 equivalent test forms

Each prepared `study2-v2` run receives one automatically selected `formId`,
currently `F1` or `F2`. The selected ID is written to `.study/run.json`, test
telemetry, the completion ZIP metadata, and the private grading result.

The forms do not change requirements, interfaces, test names, frame counts, or
public/private allocation. They substitute equivalent names, paths, exception
messages, and pairing values inside the same contract-derived frames. Both
forms therefore run 3 A tests, 3 B tests, and 3 integration tests publicly for
each task. The private goal suites retain the same 20 TreeNode and 17 Exception
Group checks.

The extension passes the assigned ID to the contextual public-test command.
Manual public `pytest` commands read the same ID from `.study/run.json`. The
clean grader reads it from the collected submission and passes it to private
checks. Older and legacy runs without an ID use `F1`.

Reference implementations were run against all public and private checks under
both IDs. Form assignment changes test data only; it does not change the state
organization, model, time limit, ticket, or correctness contract.
