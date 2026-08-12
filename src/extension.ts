/**
 * VS Code extension entry point.
 *
 * Responsibilities:
 *   - Activate on startup
 *   - Manage API key in SecretStorage
 *   - Wire up provider, workspace, webview
 *   - Register commands
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Workspace } from './core/workspace';
import { Storage } from './core/storage';
import { WorkspaceCapture } from './core/file-watcher';
import { LLMProvider, createProvider } from './llm/provider';
import { ContextBranchView } from './webview/webview-manager';
import { StudyExport } from './core/types';
import { StudyController } from './study/controller';

const SECRET_KEY = 'contextbranch.apiKey';

let workspace: Workspace | null = null;
let provider: LLMProvider | null = null;
let view: ContextBranchView | null = null;
let capture: WorkspaceCapture | null = null;
let statusBar: vscode.StatusBarItem | null = null;
let studyController: StudyController | null = null;

export async function activate(context: vscode.ExtensionContext) {
  // 1. Register the webview view FIRST so the user always sees the panel,
  //    even before a workspace folder is open. The view's first render will
  //    show a clear "open a folder" message instead of failing silently.
  const config = vscode.workspace.getConfiguration('contextbranch');
  view = new ContextBranchView(
    context,  
    () => workspace,
    () => provider,
    () => studyController?.condition ?? config.get<'linear' | 'branched' | 'contextbranch'>('condition') ?? 'branched',
    () => config.get<boolean>('studyMode') ?? false,
    () => capture, // give the view access so it can suppress paths around its own writes
    () => studyController,
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ContextBranchView.viewType, view, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // 1b. Status bar item — shows the active branch and clicks open the sidebar.
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'contextbranch.open';
  statusBar.tooltip = 'ContextBranch — current branch (click to open sidebar)';
  context.subscriptions.push(statusBar);
  updateStatusBar();

  // Imports pre-existing files exactly once per project (guarded by a sentinel
  // file), so re-activations / reloads don't re-add files you've since deleted.
  function runInitialIngest(cbRoot: string): void {
    try {
      const marker = path.join(cbRoot, '.ingested');
      if (fs.existsSync(marker)) return;
      const n = capture?.ingestExisting() ?? 0;
      fs.mkdirSync(cbRoot, { recursive: true });
      fs.writeFileSync(marker, String(Date.now()));
      if (n > 0) {
        view?.pushState();
        updateStatusBar();
        vscode.window.showInformationMessage(
          `ContextBranch: imported ${n} existing file${n === 1 ? '' : 's'} into main.`
        );
      }
    } catch { /* non-fatal */ }
  }

  async function recoverFinishedStudyArchive(): Promise<void> {
    if (!studyController || !workspace || !studyController.isFinished()) return;
    try {
      const archive = await studyController.exportFinishedArchive(workspace);
      if (archive.created) {
        vscode.window.showInformationMessage(`Study data ZIP recovered: ${archive.fileName}`);
      }
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Completed study data could not be archived: ${error.message ?? String(error)}`,
      );
    }
  }

  async function focusStudyPanel(): Promise<void> {
    if (!studyController) return;
    // In a prepared study workspace, keep the participant in ContextBranch,
    // not VS Code's own Chat. The workspace settings place the primary Side
    // Bar on the right; this command focuses the contributed view there.
    try {
      await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
      await vscode.commands.executeCommand('contextbranch.sidebar.focus');
    } catch {
      // Focus is presentation-only. The study remains usable if a host build
      // does not expose one of the workbench commands.
    }
  }

  // 2. Initialize storage in workspace (if a folder is open)
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let storage: Storage | null = null;
  if (root) {
    studyController = StudyController.load(root);
    const cbRoot = path.join(root, '.contextbranch');
    storage = new Storage(cbRoot);
    workspace = new Workspace(storage);

    // 2b. File watcher — captures user edits into the active branch.
    capture = new WorkspaceCapture(root, () => workspace, () => {
      view?.pushState();
      updateStatusBar();
    });
    capture.start();
    context.subscriptions.push(capture);

    // 2c. One-time import: if the folder already had files when ContextBranch
    //     was first initialized here, fold them into main so the starting state
    //     is captured (otherwise only files you later touch get captured).
    runInitialIngest(cbRoot);
    studyController?.initialize(workspace);
    void recoverFinishedStudyArchive();
    void focusStudyPanel();
  } else {
    vscode.window.showWarningMessage(
      'ContextBranch: open a folder first, then reload the window.'
    );
  }

  // 3. Try to set up provider from stored key
  await setupProvider(context);
  view.pushState();
  updateStatusBar();

  // 4. React to workspace folder changes — let the user open a folder
  //    AFTER activation without forcing a reload.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (newRoot && !workspace) {
        studyController = StudyController.load(newRoot);
        const cbRoot = path.join(newRoot, '.contextbranch');
        storage = new Storage(cbRoot);
        workspace = new Workspace(storage);
        capture?.dispose();
        capture = new WorkspaceCapture(newRoot, () => workspace, () => {
          view?.pushState();
          updateStatusBar();
        });
        capture.start();
        view?.pushState();
        updateStatusBar();
        runInitialIngest(cbRoot);
        studyController?.initialize(workspace);
        void recoverFinishedStudyArchive();
        void focusStudyPanel();
        vscode.window.showInformationMessage('ContextBranch: workspace ready.');
      }
    })
  );

  // 5. Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('contextbranch.open', () => {
      vscode.commands.executeCommand('contextbranch.sidebar.focus');
    }),
    vscode.commands.registerCommand('contextbranch.setApiKey', async () => {
      const providerName = await vscode.window.showQuickPick(
        ['anthropic', 'openai', 'openrouter', 'gemini'],
        { placeHolder: 'Select provider' }
      );
      if (!providerName) return;
      const key = await vscode.window.showInputBox({
        prompt: `Enter API key for ${providerName}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      await context.secrets.store(SECRET_KEY, JSON.stringify({ provider: providerName, key }));
      await config.update('provider', providerName, vscode.ConfigurationTarget.Global);
      await setupProvider(context);
      vscode.window.showInformationMessage(`ContextBranch: ${providerName} key saved.`);
      view?.pushState();
    }),
    vscode.commands.registerCommand('contextbranch.exportStudyData', async () => {
      if (!workspace) {
        vscode.window.showErrorMessage('Open a folder first.');
        return;
      }
      const out = await exportStudyData(workspace, config);
      const target = await vscode.window.showSaveDialog({
        filters: { JSON: ['json'] },
        defaultUri: vscode.Uri.file(`contextbranch-study-${Date.now()}.json`),
      });
      if (!target) return;
      fs.writeFileSync(target.fsPath, JSON.stringify(out, null, 2));
      vscode.window.showInformationMessage(`Study data exported.`);
    }),
    vscode.commands.registerCommand('contextbranch.resetWorkspace', async () => {
      if (studyController) {
        vscode.window.showErrorMessage('ContextBranch data cannot be reset during a prepared study task.');
        return;
      }
      if (!storage) {
        vscode.window.showErrorMessage('Open a folder first.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        'Delete ALL ContextBranch data in this workspace? Cannot be undone.',
        { modal: true }, 'Delete', 'Cancel'
      );
      if (confirm !== 'Delete') return;
      storage.reset();
      workspace = new Workspace(storage);
      view?.pushState();
      vscode.window.showInformationMessage('ContextBranch reset.');
    }),
  );

  const studyTimer = setInterval(() => {
    if (studyController) {
      void view?.checkStudyTimeout();
      view?.pushState();
    }
  }, 1000);
  context.subscriptions.push({ dispose: () => clearInterval(studyTimer) });

  // 6. Watch for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('contextbranch.provider') ||
          e.affectsConfiguration('contextbranch.model')) {
        await setupProvider(context);
        view?.pushState();
      }
    })
  );

  // 6. First-launch onboarding
  if (!provider) {
    const action = await vscode.window.showInformationMessage(
      'ContextBranch: set an API key to get started.',
      'Set API Key', 'Later'
    );
    if (action === 'Set API Key') {
      vscode.commands.executeCommand('contextbranch.setApiKey');
    }
  }
}

export function deactivate(): void {
  // No-op: storage is already persisted.
}

/**
 * Refresh the status bar item. Called after branch switches, branch creates,
 * merges, and provider changes. Shows "$(git-branch) <branchName>" when a
 * workspace is open, "$(git-branch) — no workspace" otherwise.
 */
function updateStatusBar(): void {
  if (!statusBar) return;
  if (!workspace) {
    statusBar.text = '$(git-branch) ContextBranch';
    statusBar.tooltip = 'ContextBranch — open a folder to start';
    statusBar.show();
    return;
  }
  const active = workspace.getBranch(workspace.activeBranchId);
  if (!active) {
    statusBar.text = '$(git-branch) ContextBranch';
    statusBar.show();
    return;
  }
  const isMain = active.id === workspace.mainBranchId;
  const icon = isMain ? '$(git-branch)' : '$(git-pull-request)';
  statusBar.text = `${icon} ${active.name}`;
  statusBar.tooltip = `ContextBranch: ${active.name} (${active.messageIds.length} messages). Click to open sidebar.`;
  statusBar.show();
}

async function setupProvider(context: vscode.ExtensionContext): Promise<void> {
  const stored = await context.secrets.get(SECRET_KEY);
  if (!stored) {
    provider = null;
    return;
  }
  try {
    const { provider: name, key } = JSON.parse(stored);
    if (studyController && name !== studyController.providerName) {
      provider = null;
      vscode.window.showErrorMessage(
        `Prepared study task requires the ${studyController.providerName} provider. Configure that provider before opening the participant workspace.`
      );
      return;
    }
    const model = vscode.workspace.getConfiguration('contextbranch').get<string>('model');
    provider = createProvider(name, key, model || undefined);
  } catch (err: any) {
    provider = null;
    vscode.window.showErrorMessage(`Failed to load provider: ${err.message}`);
  }
}

async function exportStudyData(ws: Workspace, config: vscode.WorkspaceConfiguration): Promise<StudyExport> {
  const branches = ws.getAllBranches();
  const mergeEvents = ws.storage.loadAllMergeEvents();
  const merged = branches.filter(b => b.status === 'merged');
  const abandoned = branches.filter(b => b.status === 'abandoned');
  const forced = mergeEvents.filter(m => m.verification.forced);

  return {
    participantId: studyController?.participantId ?? config.get<string>('participantId') ?? '',
    condition: studyController?.condition ?? config.get<'linear' | 'branched' | 'contextbranch'>('condition') ?? 'branched',
    exportedAt: Date.now(),
    sessionDurationMs: Date.now() - ws.workspaceState.telemetry.sessionStartedAt,
    branches,
    mergeEvents,
    branchCount: branches.length,
    mergeCount: merged.length,
    forcedMergeCount: forced.length,
    abandonedBranchCount: abandoned.length,
  };
}
