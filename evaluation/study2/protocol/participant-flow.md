# Study 2 participant flow

This file defines the shared flow. Copy-ready tool guides are in
`participant-instructions/`; the prepared workspace supplies `.study/TASK.md`.

## Before the session

The operator assigns a pseudonymous ID through `studyctl`. The `study2-v2`
sequence fixes task order and condition order. The operator prepares one fresh
workspace per period and gives the participant one matching tool guide. The
task sheet is the `.study/TASK.md` generated from the frozen main ticket.

## Shared onboarding, about 10 minutes

Use an unrelated toy workspace. Teach how to:

1. find the active state;
2. send a self-written prompt;
3. review, apply, or discard a proposed edit;
4. run the current public-test button and read the bottom Test Results panel;
5. switch states and inspect the view-only State Map; and
6. preview an integration.

Teach controls only. Do not provide a reusable task prompt, task code, or an
implementation strategy.

## Each task period, up to 21 minutes 40 seconds

1. The participant reads `.study/TASK.md`, the allowed production files, and
   the readable public tests before starting the timer.
2. The participant clicks **Start task**.
3. The system shows the complete feature ticket and starts the wall-clock
   timer.
4. In Linear, the participant works in one `main` conversation and code state.
5. In ContextBranch, the system creates two optional sibling states from the
   same checkpoint. Each sibling repeats only its matching requirement subset.
6. The participant writes prompts, reviews edits, may edit code manually, and
   may run public tests.
7. In ContextBranch, the participant may use either sibling, both, neither, or
   `main`, in any order. Generation may run in two different states at the same
   time.
8. The participant may integrate an active sibling into `main` after reviewing
   the preview. Integration is optional.
9. The participant clicks **Finish task** when ready. At timeout, the tool
   automatically submits the current final `main`.

The contextual test button runs A in the A sibling, B in the B sibling, and the
complete A+B+integration suite in `main`. Passing a sibling suite is not task
completion. Only final `main` is submitted.

## After each task

The participant completes Raw NASA-TLX. The operator verifies the completion
record and automatic ZIP, then opens the next prepared workspace. The operator
does not show private checks or feed private failures back to the model.

After both tasks, the operator collects the fixed submissions and runs clean
private grading. A short interview asks about prompts, tests, state switching,
integration, and concrete points of difficulty. Study 2 does not collect SUS.
