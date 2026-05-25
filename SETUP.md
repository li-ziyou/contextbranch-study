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

