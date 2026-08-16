# Study 2 v2 rollback

The implementation branch was created from:

- repository: `git@github.com:li-ziyou/contextbranch-study.git`
- original branch: `main`
- original commit: `854dc65ee35b24b8c15cf87a57ae0c98d2a09957`
- implementation branch: `codex/study2-tree-exception-pilot`

The original task IDs are `markdown-command-template-library` and
`rgb-image-composer`. Their manifests and assets remain in place.

## Configuration-only rollback

Keep the current code and select the old task set:

```bash
npm run study:assign -- P000 --task-set legacy
npm run study:prepare -- P000 1 --task-set legacy \
  --provider FIXED_PROVIDER --model FIXED_MODEL
```

Use `--task-set legacy` with `study:build-tasks`, `study:preflight`, and
`study:dry-run` when only the old tasks should be operated.

## Git rollback

Return to the unchanged original branch:

```bash
git switch main
```

Or inspect the exact original baseline without changing `main`:

```bash
git switch --detach 854dc65ee35b24b8c15cf87a57ae0c98d2a09957
```

No push or pull request is part of this implementation run.
