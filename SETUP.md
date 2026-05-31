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

## Study mode

For controlled user study:

```json
"contextbranch.studyMode": true,
"contextbranch.participantId": "P01",
"contextbranch.condition": "branched"   // or "linear"
```

When `condition: "linear"` is set, branching UI is disabled — participants can only chat in main. This lets you A/B compare interaction models cleanly.

## Export study data

In the Extension Development Host:

1. Cmd/Ctrl+Shift+P → **ContextBranch: Export Study Data**
2. Pick a save location.

Output is a single anonymized JSON containing all branches, merge events, timings, token counts, override rates, etc. — see `src/core/types.ts → StudyExport` for schema.

## Reset

Cmd/Ctrl+Shift+P → **ContextBranch: Reset Workspace** — deletes all `.contextbranch/` data. Useful between participants.

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

This produces `contextbranch-0.1.0.vsix` which can be installed in VS Code via:

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