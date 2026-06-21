# ContextBranch

Git-style branching and merging for AI coding chat, inside VS Code.

A research prototype investigating whether non-linear conversation structure helps programmers manage complexity in AI-assisted coding tasks.

## What it does

- Treats your AI conversation as a **branchable graph**, not a linear transcript.
- Every branch has its own conversation thread + its own artifact set (files the AI created/modified).
- Merges into other branches go through **verified merge**: the system runs your test/lint commands on the merged result before finalizing. You can force-merge if you really want, and that gets recorded.
- An **AI Decomposition Agent** can split a task description into a proposed branch DAG with merge order.
- A **Meta Agent** watches the graph and surfaces patterns at key events (branch created, merge attempted, etc.) — silent otherwise.
- All conversation history is **stored locally** in `.contextbranch/` in your workspace.

## Architecture

```
  ┌─────────────────────┐
  │ VS Code Extension   │
  │  (Node, TypeScript) │
  └──────────┬──────────┘
             │ postMessage
  ┌──────────▼──────────┐
  │   Webview (HTML/JS) │
  │  Three-pane UI      │
  └─────────────────────┘

  Storage: .contextbranch/objects/   (content-addressable: messages, artifacts, checkpoints)
           .contextbranch/branches/  (branch metadata)
           .contextbranch/merges/    (merge events, audit trail)
           .contextbranch/telemetry/ (append-only JSONL for study analysis)
```

## Quick start

See [SETUP.md](./SETUP.md) for full instructions. TL;DR:

```bash
npm install
npm run build
# Press F5 in VS Code to launch the Extension Development Host
```

Then in the new VS Code window:

1. Open a folder.
2. Click the **ContextBranch** icon in the activity bar.
3. Run `ContextBranch: Set API Key` from the Command Palette.
4. Pick a provider (Anthropic / OpenAI / Gemini), paste your key.
5. Start chatting in the conversation pane.
6. Click **+ Branch** on any message to fork the conversation.
7. Click **⤵ Merge** when ready to fold a branch into another.

## Research foundations

This implementation synthesizes three papers:

- **Laban et al. 2025** — *LLMs Get Lost in Multi-Turn Conversation*. Multi-turn LLM performance degrades 39% on average; consolidation (CONCAT) restores it. → ContextBranch consolidates branch conversations at merge time.
- **Kimm & Tan 2024** — *ChatGraPhT*. Two-agent design (Graph + Meta) for visual reflective dialogue. → ContextBranch uses Coding + Decomposition + Meta agents with discipline about when each speaks.
- **Chickmagalur & Maaheshwari 2025** — *ContextBranch*. Four primitives (checkpoint, branch, switch, inject) with content-addressable storage. → Direct foundation; this project extends with verified merge, artifact tracking, decomposition, and a VS Code-native UI.

## Project status

Early research prototype. Stable enough for a controlled user study; not production-grade.

## Folder layout

```
contextbranch/
├── package.json              VS Code extension manifest
├── tsconfig.json
├── esbuild.js                Bundler
├── src/
│   ├── extension.ts          Entry: activation, commands, secret storage
│   ├── core/
│   │   ├── types.ts          Data model
│   │   ├── storage.ts        Content-addressable, atomic-write storage
│   │   ├── workspace.ts      Branch / message / checkpoint orchestration
│   │   └── merge.ts          Verified merge with lazy rebase + 3-way artifact merge
│   ├── llm/
│   │   ├── provider.ts       Anthropic / OpenAI / Gemini abstractions w/ streaming
│   │   └── prompts.ts        All system prompts (research artifacts)
│   ├── agents/
│   │   ├── coding.ts         Per-branch chat + artifact extraction
│   │   ├── decomposition.ts  Task → branch DAG
│   │   └── meta.ts           Event-triggered observer + consolidation
│   └── webview/
│       └── webview-manager.ts  UI host + message bus
├── webview/
│   ├── index.html            Three-pane layout
│   ├── style.css             Themed via VS Code CSS variables
│   └── app.js                Vanilla JS — no React build complexity
├── evaluation/               User-study replication package
│   ├── README.md             Overview of the evaluation setup
│   ├── protocol/             Study protocol, task descriptions, consent forms
│   ├── tasks/                Starter applications given to participants
│   ├── data/                 Collected telemetry / session data (per participant)
│   └── analysis/             Scripts and notebooks for analyzing study results
└── media/icon.svg
```

## License

MIT (research prototype).