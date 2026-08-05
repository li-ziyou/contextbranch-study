# Task builder

The builder creates two separate outputs for each curated,
FeatureBench-derived task:

- `participant/` is a fresh, small Git workspace with the intentionally
  incomplete baseline, ticket, public tests, and public runner. It has no
  reference repair, hidden tests, or grader.
- `private/` contains the same clean baseline, the reference implementation
  for operator dry runs, and three hidden behavioural groups.

Build both bundles with the repository command. It creates a local builder
environment if one is not already present:

```bash
npm run study:build-tasks
```

The manifests retain the FeatureBench instance ID and upstream commit that
inspired each task. The builder uses the reviewed local task assets rather than
downloading or applying an upstream patch. It copies the baseline into a clean
local Git workspace and places the reference implementation only in the private
bundle. Public and private tests use the same isolated Study Python runtime.
