# Task builder

The builder creates two separate outputs for each FeatureBench instance:

- `participant/` is a fresh, small Git workspace with only the task's
  production files, feature mutation, ticket, public tests, and public runner.
  It has no remote, FeatureBench patch, original F2P test, hidden tests, or
  grader.
- `private/` contains the same small clean mutation baseline, the original
  FeatureBench F2P test for audit, and three hidden behavioural groups.

Build both bundles with the repository command. It creates a local builder
environment if one is not already present:

```bash
npm run study:build-tasks
```

The builder downloads the FeatureBench Parquet file, checks the pinned patch
hashes from the task manifests, sparse-checks out the stated source commit,
applies only the allowlisted production diff, and reinitializes the participant
copy as a clean local Git baseline. Public and private tests use the same
isolated Study Python runtime, which contains only the dependencies and small
support modules required by these two features.
