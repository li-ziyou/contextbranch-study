# ContextBranch Study 2

This directory contains every source artifact needed to run the controlled
feature-implementation user study. The participant-facing tool remains the VS
Code ContextBranch extension at the repository root.

Study 1 is an existing formative pilot and is not implemented or rerun here.
Study 2 compares a linear AI coding workflow with automatic divide-and-conquer
plus user-controlled reintegration.

## Fixed task pair

| Task ID | Participant-facing name | FeatureBench source |
|---|---|---|
| `markdown-command-template-library` | Markdown Command Template Library | `mlflow__mlflow.93dab383.test_ai_command_utils.85dcb487.lv1` |
| `rgb-image-composer` | RGB Image Composer | `astropy__astropy.b0db0daa.test_basic_rgb.067e927c.lv1` |

Every participant completes both tasks. One is assigned to Linear and the
other to ContextBranch. `operator/assignment-sequences.json` defines the four
balanced sequences.

## What the participant receives

For one period, the operator creates a fresh participant bundle containing:

1. a sanitized feature-mutation workspace;
2. the task ticket and the two frozen implementation-intent labels;
3. readable, read-only public tests and a fixed public-test command;
4. ContextBranch in the assigned condition; and
5. a fixed model, system prompt, edit policy, time limit, and pooled budget.

The participant never receives upstream history, source patches, private tests,
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
manifests/       Frozen task contracts and their schema.
operator/        Assignment generation and the future study launcher.
protocol/        Participant flow and researcher runbook.
task-builder/    Rules for producing safe participant bundles.
public-tests/    Public-test contract; concrete files are task-builder output.
private-grader/  Fresh-baseline clean-patch evaluation contract.
tasks/           Task-specific source and expected code-surface notes.
```

## Current implementation order

1. Implement the manifest loader and `StudyController` in `src/study/`.
2. Build the Markdown task end to end: sanitized baseline, public test runner,
   submit capture, and private clean grader.
3. Repeat the same verified path for RGB.
4. Connect assignment, timer, pooled model budget, and automatic export.
5. Run technical dry runs in all four task-condition orders before data
   collection.

The two commands already available in this bootstrap are:

```bash
npm run study:validate
npm run study:assign -- P017
```

`study:validate` checks the frozen manifests. `study:assign` prints a
deterministic sequence; it does not write participant data.
