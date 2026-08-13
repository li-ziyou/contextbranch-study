# ContextBranch Study 2: full end-to-end runbook

This runbook describes one complete session. It uses `P001` only as an
example. `P000` is reserved for technical rehearsals and maps to sequence S1.
Give every formal participant a new pseudonymous ID starting from `P001`, and
never reuse an ID for a replacement or a repeat session.

Use one fixed configuration for all participants in the same study profile:

| Setting | Value |
| --- | --- |
| Provider | OpenRouter |
| Model | `anthropic/claude-haiku-4.5` |
| Task limit | 1300 seconds (21 minutes 40 seconds) |
| Model-call budget | 20 per task |
| Model-token budget | 120000 per task |

The full session is about 70 minutes. The participant works only with the
supplied task test suite. The clean private grader is used by the research team
after the session and is never shown to the participant.

## 1. One-time operator setup

The commands below assume the Study 2 worktree is
`/Users/zli38/Documents/contextbranch-study`.

```bash
cd /Users/zli38/Documents/contextbranch-study

npm run study:build-tasks -- --task-set study2-v2
npm run study:setup-runtime
npm run study:preflight -- --task-set study2-v2
npm run study:dry-run -- --task-set study2-v2
npm run build
npm run package
```

Install the generated extension, then reload VS Code:

```text
/Users/zli38/Documents/contextbranch-study/contextbranch-0.3.0.vsix
```

In VS Code, open the Command Palette and run `ContextBranch: Set API Key`.
Select `openrouter` and enter the research team API key before the participant
arrives. The participant must not see or enter the key.

Each prepared study workspace uses VS Code's standard two-sidebar layout:
the Activity Bar and File Explorer remain on the left, while ContextBranch
opens in the right Secondary Side Bar. On activation, ContextBranch closes any
restored auxiliary view and focuses its own panel, so VS Code's built-in Chat
is not shown to the participant. If VS Code restores an earlier layout, run
`Developer: Reload Window` before the participant arrives.

Record the extension commit, the prepared task manifests, provider, model,
time limit, model-call budget, and token budget in the operator log.

## 2. Prepare a participant session

For a rehearsal, create a new temporary runs root. For formal collection, the
default `evaluation/study2/runs` root can be used instead. The command creates
a timestamped participant session directory automatically.

```bash
cd /Users/zli38/Documents/contextbranch-study

RUNS_ROOT=$(mktemp -d /tmp/contextbranch-study2-rehearsal.XXXXXX)
printf '%s\n' "$RUNS_ROOT"

npm run study:prepare -- P001 1 \
  --task-set study2-v2 \
  --provider openrouter \
  --model anthropic/claude-haiku-4.5 \
  --time-limit 1300 \
  --model-calls 20 \
  --model-tokens 120000 \
  --runs "$RUNS_ROOT"
```

The command prints a `sessionRoot` and a `workspace`. The first P001 period
creates a directory such as:

```text
/tmp/contextbranch-study2-rehearsal.XXXXXX/P001_20260812T142407Z/
```

Open the exact printed `workspace` path in VS Code. For P001, the first period
is Markdown Command Template Library in the Linear condition. The assignment
for every other ID is determined by `study:assign`; do not choose task or
condition manually.

## 3. Participant session

### Consent and onboarding, 10 minutes

The participant reads the information sheet, signs the consent form, and
completes the background questionnaire using only the assigned pseudonymous
ID. Then use an unrelated toy workspace to point out how to send a prompt,
inspect an edit or diff, run the supplied test command, and open the
ContextBranch panel. Explain controls, not either study task and not an
implementation strategy.

### Period 1, up to 1300 seconds

The participant opens the ContextBranch panel, reads `.study/TASK.md` and the
supplied task tests, then clicks `Start task`.

In Linear, the participant has one chat and one code state. The State Map,
sibling states, and integration control are not shown. The participant may
prompt the assistant, inspect or edit code, and run task tests. They can click
`Finish task` when ready.

When the timer reaches zero, the system automatically fixes the current main
state as the submission and writes the data ZIP. An incomplete feature remains
valid study data. The operator does not explain code, suggest a prompt, or
direct an implementation route.

Immediately after the task, the participant completes Raw NASA-TLX. Do not
administer SUS or the Study 1 task-reflection questionnaire.

### Prepare Period 2, about 2 minutes

Keep the same `RUNS_ROOT` and prepare the second period:

```bash
cd /Users/zli38/Documents/contextbranch-study

npm run study:prepare -- P001 2 --runs "$RUNS_ROOT"
```

Open the new printed workspace. It is placed in the same
`<participant-id>_YYYYMMDDTHHMMSSZ` session directory as Period 1. For P001,
Period 2 is RGB Image Composer in the ContextBranch condition.

### Period 2, up to 1300 seconds

The participant again reads the ticket and task tests, then clicks `Start
task`. ContextBranch automatically creates two sibling conversation-code
states. The main state keeps the complete feature ticket. Each sibling begins
from the same root checkpoint and receives only the matching responsibility
requirements copied from the complete ticket. Participants may inspect,
switch, compare, ignore, or integrate states in any order. The
system remains in `main` after creating the sibling states; it does not switch
the participant into either branch automatically.

The participant may work in either state, switch between them, compare code
changes or test evidence, ignore one state, or work in only one state. If work
from an active sibling state should become part of the final implementation,
the participant can select `Integrate this state into main`, review the merge
preview, and confirm it. They then return to main, run task tests if desired,
and click `Finish task`.

The participant is not required to use both states, create two patches, or
integrate a state. Only the final main state is submitted. Immediately after
the task, the participant completes the second Raw NASA-TLX questionnaire.

### Interview, 10 minutes

Ask about concrete moments from the two tasks:

- How did the participant use test evidence?
- In ContextBranch, did they switch states? Why?
- Did they integrate a state into main? Why or why not?
- What helped or slowed down their work?
- Did the separated states affect how they understood the feature?

## 4. Data handoff and verification

At `Finish task` or time expiry, the extension automatically writes one ZIP to
the current participant session directory:

```text
P001_20260812T142407Z/
  participant-exports/
    P001_markdown-command-template-library_linear_1.zip
    P001_rgb-image-composer_contextbranch_2.zip
```

Each ZIP contains the final allowlisted main-state production files, task
ticket, completion record, and ContextBranch conversation/state/telemetry
store. It excludes API keys, `.git`, private tests, and the private grader.
Check that both ZIPs exist before the participant leaves, then transfer the
two ZIPs to the research team. Do not edit a finished workspace.

For clean evaluation, extract each ZIP and run the private grader on its
`submission/main` directory. For example:

```bash
unzip P001_markdown-command-template-library_linear_1.zip -d P001-period1

npm run study:grade -- \
  --bundle participant-bundles/markdown-command-template-library \
  --submission P001-period1/submission/main \
  --result evaluation/study2/private-results/P001-period1.json
```

The grader applies only the allowlisted final production files to a fresh
private baseline, then checks the three behavioural goals. Its result is an
auditable verified-delivery record, not a participant score. Timeout,
incomplete implementation, no state switching, or no integration is valid data;
mark a run invalid only for withdrawal, consent withdrawal, or documented
infrastructure or data-capture failure.

Before formal collection, run all four assignment sequences as technical dry
runs. Each dry run must confirm condition parity, two automatic sibling states
in ContextBranch, task-test determinism, final-main-state capture, automatic
ZIP export, and clean grading.
