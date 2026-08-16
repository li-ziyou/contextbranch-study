# Study 2 v2 rehearsal plan

## Fixed inputs

Use one prepared `study-profile.json` for both conditions. A technical rehearsal may use participant IDs `P900` and `P901`; each participant's two periods share the same provider, model, and time limit. Model calls and tokens are recorded without a ceiling. Each run records its automatically selected equivalent test form.

## One-shot model pilot

For each task, send the complete main ticket once with no follow-up. Record public A, B, integration, and clean A/B/integration outcomes. A task requires review if the fixed model routinely reaches overall correctness in one turn.

## Responsibility pilot

Run A and B separately from the same incomplete checkpoint. A must produce meaningful A evidence without B. B must pass its focused suite through the public shared contract or stub without A. Do not give either run text absent from the complete ticket.

## Integration pilot

Create the two sibling states from the same main checkpoint, produce locally passing A and B candidates, preview each integration into main in either order, run the full public suite in main, then finish, collect, and clean grade. Record whether a small interface correction is needed and whether the process is neither purely mechanical nor routinely impossible.

## Approval evidence

Automated implementation-shape checks are in `validation-results.json`. Live fixed-model one-shot and interactive UX pilots must be recorded in `validation-report.md` before formal freeze; they are not replaced by reference-solution dry runs.
