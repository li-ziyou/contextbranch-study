# Local Study 2 v2 trial

Prepared technical-rehearsal sessions:

- current untouched UI trial: `evaluation/study2/runs/P900_20260813T205857Z`
- completed collect/grade/export rehearsal: `evaluation/study2/runs/P000_20260813T205527Z`

## Workspaces

- Linear: `P900-period2-tree-node-navigation-linear/workspace`
- ContextBranch: `P900-period1-exception-group-matcher-contextbranch/workspace`

Both use the frozen profile `openrouter` / `anthropic/claude-haiku-4.5`, 1,500 seconds, 20 model calls, and 120,000 pooled tokens. The model is configured identically; API-key availability remains in VS Code SecretStorage.

## Participant actions

1. Use the already-open VS Code development-host window for the desired condition.
2. If the assistant reports no key, run `ContextBranch: Set API Key`, select OpenRouter, and provide the research key.
3. Click `Start task`.
4. Work in main for Linear. For ContextBranch, use either sibling, both, neither, or main in any order; preview before integrating a sibling into main.
5. Run the public test button or the commands in `TASK.md`.
6. Return to main and click `Finish task`.

## Operator collection and grading

```bash
npm run study:collect -- P900-period2-tree-node-navigation-linear
npm run study:collect -- P900-period1-exception-group-matcher-contextbranch

npm run study:grade -- \
  --bundle participant-bundles/tree-node-navigation \
  --submission evaluation/study2/runs/P900_20260813T205857Z/P900-period2-tree-node-navigation-linear/submission/main \
  --result evaluation/study2/private-results/P900-tree.json
```

Use the corresponding Exception Group bundle and submission path for period 2.

## Stop and reset

Close the two VS Code development-host windows to stop the local flow. To create untouched rehearsal workspaces again, use a new technical participant ID or remove only the ignored rehearsal session after confirming it contains no needed trial data.
