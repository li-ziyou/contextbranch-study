# Public tests

Public tests are small acceptance checks supplied to participants. They can be
edited, deleted, or bypassed without changing the final result because the
private grader later reconstructs the repair on a separate clean baseline.
Each generated workspace includes the command below:

```bash
python3 .study/bin/study_runner.py public --workspace .
```

It runs the visible test folder in the prepared local Study Python runtime.
That runtime contains only the task dependencies and support modules, not the
full upstream repository or a participant-controlled test environment.
