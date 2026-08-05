# Clean private grader

`grade_submission.py` does not run a participant's workspace directly. It
starts from `private/mutation`, copies only the allowlisted production paths
from the captured final main state, then runs three hidden behavioural groups
inside the prepared Study Python runtime. Public tests, test scripts, package
configuration, and participant-created files cannot affect the result.

```bash
python3 evaluation/study2/private-grader/grade_submission.py \
  --bundle participant-bundles/markdown-command-template-library \
  --submission evaluation/study2/runs/RUN_ID/submission/main \
  --result evaluation/study2/private-results/RUN_ID.json
```

The JSON record contains the clean-patch status, the three goal identifiers,
the container result, and the binary `verifiedFeatureDelivery` outcome. It is
an auditable result record, not a participant-facing score.
