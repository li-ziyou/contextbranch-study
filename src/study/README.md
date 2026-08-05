# Study controller source

`types.ts` defines the frozen contract between task manifests, the operator,
and the VS Code extension. The next implementation introduces:

- `manifest.ts`: read and validate a task manifest, then record its hash;
- `controller.ts`: start/finish a period and create automatic sibling states;
- `budget.ts`: enforce one pooled model budget across Linear and ContextBranch;
- `task-runner.ts`: run public tests in the configured isolated image; and
- `submission.ts`: capture final main-state production diffs for the private
  grader.

The existing generic `DecompositionAgent`, manual branch creation, semantic
merge analyst, conflict resolver, Meta Agent, and force merge are bypassed when
the controller is active.
