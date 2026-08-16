# Setup

Steps to install, build, and run ContextBranch locally.

## Prerequisites

- **Node.js ≥ 18** (`node --version`)
- **VS Code ≥ 1.85**
- An API key for at least one of: Anthropic, OpenAI, Google Gemini

## Install

```bash
cd contextbranch
npm install
```

This pulls in `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, and dev dependencies (esbuild, typescript, vsce).

## Build

```bash
npm run build
```

This produces `dist/extension.js` via esbuild (CommonJS, Node target).

For development:

```bash
npm run watch
```

## Run in VS Code (development mode)

1. Open the `contextbranch/` folder in VS Code.
2. Press **F5** (or Run → Start Debugging).
3. A new VS Code window opens — the **Extension Development Host**.
4. In that new window, **open a folder** (any project folder will work). ContextBranch needs a workspace folder open to store its data.
5. Click the **ContextBranch** icon in the Activity Bar (left side).
6. The sidebar opens. You'll see a banner asking for an API key.

## Set your API key

In the Extension Development Host window:

1. Open Command Palette: **Cmd/Ctrl+Shift+P**
2. Run **ContextBranch: Set API Key**
3. Pick provider (anthropic / openai / gemini)
4. Paste your API key

The key is stored in VS Code's `SecretStorage` (encrypted, OS-level keychain). Not visible in settings, not in any file.

## Use it

- **Send a message**: type in the composer at the bottom, press Cmd/Ctrl+Enter or click Send.
- **Branch**: click **+ Branch** in the header (creates a fork from current state) — or hover any message and click "Branch from here" to fork from that point.
- **Switch branches**: click any branch in the left sidebar.
- **Decompose a task**: click **⎇ Decompose**, describe the task, the AI proposes a branch DAG with merge order.
- **Merge**: click **⤵ Merge**, pick target, click **Preview**, review verification + synthesis, click **Finalize merge** (or **Force merge** if verification failed but you want to proceed anyway).
- **Apply branch artifacts to your workspace**: click **📝 Apply** to actually write the AI-generated files to disk. *Switching branches alone does NOT touch your workspace files.* The Apply button is the only way files get written.
- **Abandon a branch**: click **✕ Abandon** to mark a branch as abandoned (read-only, hidden from active list, kept for study data).

## Verified merge: configuring tests

By default ContextBranch auto-detects:
- `npm test` if a `package.json` with `test` script exists
- `pytest -q` if `pyproject.toml` / `pytest.ini` / `tests/` exists
- `cargo test --quiet` if `Cargo.toml` exists

To override, set in VS Code settings:

```json
"contextbranch.testCommand": "your-test-command-here",
"contextbranch.lintCommand": "your-lint-command-here"
```

The test/lint commands run with a 60s timeout in the workspace root. If they exit non-zero, the merge preview shows **FAIL** and the user must either fix the branch and retry or force-merge.

## Study 2 setup

Do not create a study workspace by manually setting VS Code preferences. The
operator command creates a fresh workspace and writes the protected assignment
file that activates study mode.

```bash
npm run study:build-tasks -- --task-set study2-v2
npm run study:setup-runtime
npm run study:preflight -- --task-set study2-v2
npm run study:dry-run -- --task-set study2-v2
npm run package
npm run study:prepare -- P017 1 --task-set study2-v2 --provider FIXED_PROVIDER --model FIXED_MODEL
```

Install the generated `.vsix` on the research machine, then open the
`workspace` path printed by `study:prepare`. The first prepared period fixes
the provider, model, and all time and model-resource limits in a local study
profile. Configure that provider's API key through `ContextBranch: Set API Key`
on the research machine before the session. Run the second period with the same
profile. After a participant finishes,
use `study:collect` and `study:grade`; do not use Reset or the general export
command during a session. The full procedure is in
[`evaluation/study2/README.md`](evaluation/study2/README.md) and
[`evaluation/study2/protocol/operator-runbook.md`](evaluation/study2/protocol/operator-runbook.md).

## Where data is stored

Per-workspace: `<workspace>/.contextbranch/`

```
.contextbranch/
├── workspace.json              top-level state
├── objects/
│   ├── m_<hash>.json           messages
│   ├── a_<hash>.json           artifacts
│   └── c_<hash>.json           checkpoints
├── branches/<id>.json
├── tasks/<id>.json
├── merges/<id>.json
└── telemetry/<date>.jsonl      append-only event log
```

Add `.contextbranch/` to your `.gitignore` if you don't want it in version control.

## Package as `.vsix` (optional, for distribution)

```bash
npm run package
```

This produces `contextbranch-0.3.0.vsix` which can be installed in VS Code via:

**Extensions** panel → ⋯ menu → **Install from VSIX...**

## Known limitations

- ContextBranch needs a workspace folder open at activation. If you open a folder *after* activation, reload the window.
- The 3-way artifact merge is a simple line-based heuristic. For production it should swap in the `diff3` library. For the study, conflict markers are emitted and the user resolves them.
- Visual DAG is currently a flat list grouped by status (active vs merged). Cytoscape.js graph view is on the roadmap.
- The Meta Agent's `observe()` event-trigger is wired only for merge-time consolidation/rebase/consistency. The branch-created and idle observe paths exist as code but aren't surfaced in UI yet — keeps the agent quiet by default, which Kimm & Tan's findings recommend.

## Troubleshooting

**"No API key configured"** — Run `ContextBranch: Set API Key`.

**"Failed to load provider"** — The stored secret is malformed. Delete and re-set the key.

**Verification keeps failing** — Check that `testCommand` actually runs in your workspace. Try it manually in a terminal first.

**Webview is blank** — Open the Webview Developer Tools (Cmd/Ctrl+Shift+P → "Developer: Open Webview Developer Tools") and check the console.
