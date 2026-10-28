# Standalone study VSIX validation

The study feature is tracked in GitHub issue #16 and PR #15. It follows the merged one-line public-test change in PR #14. The installer version is 0.4.0.

## Executed locally on macOS ARM64

- Installed uv 0.13.6 from its pinned, SHA-256-checked release archive into a new temporary folder. The extension then downloaded its own Python 3.14.0 and installed pytest 9.2.0, without using the operator's installed Python.
- Prepared all four G1–G4 sequences. Every run has the expected task/condition, one assigned F1/F2 form, a null start time and a 1200-second budget.
- Ran the bundled public runner under the new Python environment. Both tasks fail all 9 tests in their incomplete baseline and pass all 9 with the reference files, under both F1 and F2. Reference files are used only by developer checks and are excluded from the VSIX.
- Exercised full two-period exports before Start, during a simulated running session and after Finish. Verified separate recorded-main, sibling and disk code; all recorded conversations; unapplied edits; partial replies; unsaved buffers; missing files; invalid period metadata; interrupted and elapsed-without-Finish states; original completion archive preservation; duplicate-output refusal; secret-file and symlink exclusion; and source-asset tamper rejection.
- Installed the actual VSIX into a separate VS Code user-data/extensions directory. The VS Code extension-host smoke test verified command registration and exported both unstarted periods through the registered UI command. It inserted an unsaved editor change and confirmed that the ZIP contains it, the document remains dirty, and no finished.json is fabricated.
- Inspected the ZIP-format VSIX. Its whitelist contains only compiled extension/UI files and public study assets; it contains no reference implementations, private graders, source checkout, downloaded runtime, participant runs or credentials. All shipped task hashes and the PR #14 assertion are checked.
- TypeScript checks and existing study merge/conflict checks pass.

The native smoke test is `scripts/vscode-study-smoke.cjs`. Place it under the installed extension directory (for example `.test/index.js`) so its VS Code test API shares the extension's API scope. Launch that installed directory with `--extensionDevelopmentPath`, its `.test` folder with `--extensionTestsPath`, an isolated `--user-data-dir` and `--extensions-dir`, and a newly prepared unstarted workspace. It replaces save/notification dialogs within the test host; no paid model request is made.

## Cross-platform checks

`.github/workflows/study-vsix.yml` runs clean runtime installation, study preparation/export checks, packaging and VSIX inspection on Windows, macOS and Linux. Runtime mappings cover x64 and ARM64 on each system. Cross-platform results must be read from the workflow run; a local macOS pass is not recorded as a Windows/Linux execution.

The installed extension downloads runtime components on first setup and uses desktop VS Code as its host. Screen/audio recordings and survey answers remain external research materials.
