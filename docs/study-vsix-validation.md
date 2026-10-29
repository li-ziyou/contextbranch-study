# Standalone study VSIX validation

The study feature is tracked in GitHub issue #16 and PR #15. It follows the merged one-line public-test change in PR #14. The current installer is `gitchat-0.4.3.vsix`, displayed as GitChat. Version 0.4.0 established the standalone runtime and export flow; 0.4.1 added automatic ordered task windows and per-task NASA-TLX access.

## GitChat 0.4.3

Issue #17 adds participant-created branches during active GitChat tasks. The
top bar exposes New branch; the existing selector and view-only State Map list
the new states. Branches inherit conversation and code, retain A/B test routing
when created from a responsibility state, and use the existing reviewed
integration flow to main. Linear tasks retain one state.

`npm run test:study-branches` exercises the shipped webview client and the actual
message handler/controller: Start/Finish/timeout and busy guards, saved edits
before watcher delivery, inherited conversations/code, nested isolation,
A/B/Main tests, conflict review before integration, and participant telemetry.
TypeScript, all-group standalone/setup, study merge controls, conflict parsing
and VSIX integrity checks pass locally on macOS ARM64.

## GitChat 0.4.2

The display name, command titles, sidebar/settings labels, status messages, study guidance and questionnaire labels use GitChat. The internal extension ID `contextbranch.contextbranch`, command/settings IDs, stored-key identity and session schema remain compatible with previous installations. Existing research condition values remain `contextbranch`/`linear`; newly displayed questionnaire labels use GitChat/Linear.

`npm run package` produces `gitchat-<version>.vsix`. Package inspection verifies the GitChat display name and command titles as well as the compatible extension identity. The native smoke test checks the installed display name and questionnaire label in addition to the existing window/export checks.

Locally verified 0.4.2 by upgrading the isolated 0.4.1 test profile: only `contextbranch.contextbranch@0.4.2` remained installed, with display name GitChat. The installed-extension smoke test passed its title, GitChat questionnaire label and unfinished export checks, including preservation of an unsaved buffer. TypeScript, all-group setup, standalone export, study merge/conflict and VSIX integrity checks passed. The separate clean VS Code window used for manual installation was left with zero installed extensions.

## Executed locally on macOS ARM64

- Installed uv 0.13.6 from its pinned, SHA-256-checked release archive into a new temporary folder. The extension then downloaded its own Python 3.14.0 and installed pytest 9.2.0, without using the operator's installed Python.
- Prepared all four G1–G4 sequences. Every run has the expected task/condition, one assigned F1/F2 form, a null start time and a 1200-second budget.
- Ran the bundled public runner under the new Python environment. Both tasks fail all 9 tests in their incomplete baseline and pass all 9 with the reference files, under both F1 and F2. Reference files are used only by developer checks and are excluded from the VSIX.
- Exercised full two-period exports before Start, during a simulated running session and after Finish. Verified separate recorded-main, sibling and disk code; all recorded conversations; unapplied edits; partial replies; unsaved buffers; missing files; invalid period metadata; interrupted and elapsed-without-Finish states; original completion archive preservation; duplicate-output refusal; secret-file and symlink exclusion; and source-asset tamper rejection.
- Installed the actual VSIX into a separate VS Code user-data/extensions directory. The VS Code extension-host smoke test verified command registration and exported both unstarted periods through the registered UI command. It inserted an unsaved editor change and confirmed that the ZIP contains it, the document remains dirty, and no finished.json is fabricated.
- Inspected the ZIP-format VSIX. Its whitelist contains only compiled extension/UI files and public study assets; it contains no reference implementations, private graders, source checkout, downloaded runtime, participant runs or credentials. All shipped task hashes and the PR #14 assertion are checked.
- TypeScript checks and existing study merge/conflict checks pass.

The native smoke test is `scripts/vscode-study-smoke.cjs`. Place it under the installed extension directory (for example `.test/index.js`) so its VS Code test API shares the extension's API scope. Launch that installed directory with `--extensionDevelopmentPath`, its `.test` folder with `--extensionTestsPath`, an isolated `--user-data-dir` and `--extensions-dir`, and a newly prepared unstarted workspace. It replaces save/notification dialogs within the test host; no paid model request is made.

## Version 0.4.1 setup checks

- `npm run test:study-setup` drives the actual setup function with native dialogs and runtime provisioning replaced at their boundaries. All G1–G4 sequences open both task roots in separate windows, with Task 1 opened last. Window settings contain participant/order labels, both start times stay null, and an undismissed ready notification does not block setup. Cancellation and missing-workspace behavior are checked.
- Questionnaire URLs use the live site's `participant` and `label` query fields. Each window gets its own period/task/condition; no credentials or local paths enter the URL. The CSV uses this label as `session_label`.
- The installed-extension smoke test checks the window title and invokes the actual NASA-TLX command with browser opening intercepted, then exercises the existing unfinished-session export.
- Completed a native P000/G1 setup using the installed 0.4.1 VSIX. Both separate task windows appeared, Task 1 was in front, and each title and study toolbar displayed its participant/order. The actual NASA-TLX buttons opened the default Chrome browser with P000 and the matching Period 1/Period 2 labels. Both task timers remained unstarted.

## Cross-platform checks

`.github/workflows/study-vsix.yml` runs clean runtime installation, study preparation/export checks, packaging and VSIX inspection on Windows, macOS and Linux. Runtime mappings cover x64 and ARM64 on each system. Cross-platform results must be read from the workflow run; a local macOS pass is not recorded as a Windows/Linux execution.

The installed extension downloads runtime components on first setup and uses desktop VS Code as its host. Screen/audio recordings and survey answers remain external research materials.
