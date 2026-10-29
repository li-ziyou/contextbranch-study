# Study controller source

`types.ts` defines the frozen contract between task manifests, the operator,
and the VS Code extension. The next implementation introduces:

- `manifest.ts`: read and validate a task manifest, then record its hash;
- `controller.ts`: start/finish a period and create automatic sibling states;
- model usage is recorded without a call or token ceiling;
- the runner executes the suite associated with the current study state; and
- `submission.ts`: capture final main-state production diffs for the private
  grader.

During an active GitChat task, participants can create branches from their
current state. These branches inherit conversation and code, preserve A/B test
routing when forked from a responsibility state, and can merge into another
active study branch or main through the reviewed merge flow. Integration events
record the selected target; final submission remains main. Creation is logged separately from automatic
sibling creation. Linear tasks retain a single main state.

The generic `DecompositionAgent`, semantic merge analyst, Meta Agent, manual
checkpoint restoration, and force merge remain disabled during prepared tasks.
