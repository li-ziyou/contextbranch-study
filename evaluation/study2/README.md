# ContextBranch Study 2

This directory contains every source artifact needed to run the controlled
feature-implementation user study. The participant-facing tool remains the VS
Code ContextBranch extension at the repository root.

Study 1 is an existing formative pilot and is not implemented or rerun here.
Study 2 compares a linear AI coding workflow with automatic divide-and-conquer
plus user-controlled reintegration. The two task themes are derived from
pinned FeatureBench instances, but the study uses curated local baselines
instead of reproducing their upstream patches. Each baseline has two
non-overlapping implementation modules and a supplied composition layer. This
makes a conflict-free integration both possible and necessary for the complete
feature. Participants receive a small local task package, not an upstream
repository or benchmark image.

## Fixed task pair

| Task ID | Participant-facing name | FeatureBench source |
|---|---|---|
| `markdown-command-template-library` | Markdown Command Template Library | MLflow command-template feature |
| `rgb-image-composer` | RGB Image Composer | Astropy RGB-composition feature |

Every participant completes both tasks. One is assigned to Linear and the
other to ContextBranch. `operator/assignment-sequences.json` defines the four
balanced sequences.

## What the participant receives

For one period, the operator creates a fresh participant bundle containing:

1. a sanitized incomplete feature workspace;
2. the task ticket and the two frozen implementation-intent labels;
3. readable, read-only public tests and a fixed public-test command;
4. ContextBranch in the assigned condition; and
5. a fixed model, system prompt, edit policy, time limit, and pooled budget.

The participant never receives source patches, reference repairs, private tests,
grader fixtures, API keys, or another participant's run data.

## Control boundaries

The operator selects task, period, and condition through `studyctl`. The study
manifest controls every condition-invariant input. The extension's study
controller controls automatic state creation, the timer, the budget, test
invocation, and export. The participant controls prompts, local edits, test
runs, state switching, and whether to initiate an integration.

In the ContextBranch condition, the system automatically creates exactly two
sibling states from the same root checkpoint. It does not autonomously write a
repair, pick a candidate, or merge code. In the Linear condition, the two same
implementation-intent labels appear in a single conversation and code state.

## Directory map

```text
manifests/       Frozen task contracts, provenance, and their schema.
operator/        Assignment generation, workspace preparation, collection, and preflight.
protocol/        Participant flow and researcher runbook.
task-assets/     Curated baseline and reference implementations, retained privately.
task-builder/    Rules for producing safe participant bundles from task assets.
public-tests/    Public-test contract; concrete files are task-builder output.
private-grader/  Fresh-baseline clean-patch evaluation contract.
tasks/           Task-specific source and expected code-surface notes.
```

## Operator commands

```bash
npm run study:validate
npm run study:assign -- P017
npm run study:build-tasks
npm run study:setup-runtime
npm run study:preflight
npm run study:dry-run
npm run study:prepare -- P017 1 --provider YOUR_FIXED_PROVIDER --model YOUR_FIXED_MODEL
```

`study:validate` checks the frozen manifests and the two-module task shape.
`study:assign` prints a deterministic sequence; it does not write participant
data. `study:build-tasks` creates the separate participant/private bundles.
`study:setup-runtime`
creates the isolated Python environment; `study:preflight` confirms that both
bundles and that environment are ready. `study:prepare` creates
one fresh period workspace. Open its printed `workspace` path in VS Code with
this extension installed; the study controller reads `.study/run.json` and
locks the assignment. The first prepared run creates `runs/study-profile.json`
with its provider, model, time limit, and model budgets; later runs must match
that profile, so the two conditions cannot silently receive different
resources. It also creates a new participant session directory named
`<participant-id>_YYYYMMDDTHHMMSSZ`; both periods for that participant, including their
automatic ZIP exports, are kept inside that directory. Before a session, configure the matching provider API key with
`ContextBranch: Set API Key` on the research machine.

`study:dry-run` applies the private reference repair to a temporary copy of
each participant bundle, runs its public suite, and runs clean private grading.
It verifies the executable task path without creating study data.

After the participant presses `Finish task`, collect and grade the main state:

```bash
npm run study:collect -- RUN_ID
npm run study:grade -- --bundle participant-bundles/TASK_ID \
  --submission evaluation/study2/runs/<participant-id>_YYYYMMDDTHHMMSSZ/RUN_ID/submission/main \
  --result evaluation/study2/private-results/RUN_ID.json
```

Finishing records hashes of the allowlisted production files. `study:collect`
checks those hashes before copying the submission, so an edit made after the
task ended cannot enter the clean grader.
