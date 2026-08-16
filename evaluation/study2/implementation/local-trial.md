# Local Study 2 v2 trial

Prepared technical-rehearsal sessions:

- current untouched UI trial: `evaluation/study2/runs/P900_20260813T205857Z`
- completed collect/grade/export rehearsal: `evaluation/study2/runs/P000_20260813T205527Z`

## Workspaces

- Linear: `P900-period2-tree-node-navigation-linear/workspace`
- ContextBranch: `P900-period1-exception-group-matcher-contextbranch/workspace`

These archived rehearsal workspaces used the earlier capped profile. New runs keep the provider, model, and time limit fixed but only record model calls and tokens; they do not enforce either ceiling. API-key availability remains in VS Code SecretStorage.

## Participant actions

1. Use the already-open VS Code development-host window for the desired condition.
2. If the assistant reports no key, run `ContextBranch: Set API Key`, select OpenRouter, and provide the research key.
3. Click `Start task`.
4. Work in main for Linear. For ContextBranch, use either sibling, both, neither, or main in any order; preview before integrating a sibling into main.
5. Use the single contextual test button. It shows `Test A` in Responsibility A,
   `Test B` in Responsibility B, and `Test Main` in main. Results appear in VS
   Code's bottom Test Results panel. The commands in `TASK.md` remain available.
6. Return to main and click `Finish task`.

## Concurrent sibling prompt check

Use an untouched ContextBranch rehearsal workspace and keep edit review enabled.

1. Start the task, open sibling A, and send a prompt that takes long enough to stream.
2. While A shows `Generating in this state...`, switch to sibling B. A must keep a `generating` badge in the state selector.
3. Send a prompt in B before A completes. B must stream independently, and switching back to A must restore A's own partial text.
4. Stop A while B is still running. Only A may stop. B must continue and complete.
5. Repeat without stopping either state. Let both finish while switching between them. Each assistant reply and proposed-edit panel must appear only in its originating state.
6. Accept A's proposal while A is active, then accept B's proposal while B is active. Switching states must continue to restore the matching artifact snapshot.
7. Check `.contextbranch/telemetry/*.jsonl`: every `study_model_call_started` and `study_model_call_completed` event from these prompts must contain the originating `stateId`.
8. Start another prompt and let the task timer expire. Timeout must stop all outstanding generations before final-main capture. The Finish button must remain disabled while any state is generating.

This check exercises real provider streaming. The compile and package checks do not replace it.

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
