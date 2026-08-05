# Participant flow

## Before the session

The operator assigns a pseudonymous participant ID through `studyctl`. The
generated sequence determines the first task, first condition, second task,
and second condition. The operator prepares a fresh workspace for each period.

## Shared onboarding, 10 minutes

The participant uses an unrelated toy workspace to learn how to send a prompt,
review an edit, run a public test, inspect a diff, switch states, and request
an integration. The onboarding teaches controls only. It contains no code or
task-specific advice from either Study 2 feature.

## Each 25-minute task period

1. The participant reads a feature ticket and opens its readable public tests.
2. The participant clicks `Start task`.
3. The system replays the frozen root brief and starts the timer.
4. In Linear, the participant works in one chat and one code state.
5. In ContextBranch, the system creates two sibling states with the same task
   context and one implementation-intent label each. The participant can work
   in either state, switch, compare evidence, and initiate integration.
6. The participant runs public tests during the task and clicks `Finish task`
   when ready. The system records a timeout if the period ends first.

The participant never has to use both states, write two patches, merge, or
state why they chose a route. The submitted artifact is always the final main
state; unmerged candidate work is not included.

## After the second task

The operator runs the clean private grader on each submitted patch and retains
the pseudonymous telemetry bundle. A short interview asks about concrete
implementation, evidence, switching, and integration moments. Study 2 does
not collect SUS.
