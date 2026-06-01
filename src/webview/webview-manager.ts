/**
 * Webview provider: hosts the UI inside VS Code's sidebar / panel.
 *
 * Communication: postMessage in both directions.
 * From extension → webview: state updates, streaming deltas, errors
 * From webview → extension: user actions (send msg, create branch, etc.)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Workspace } from '../core/workspace';
import { WorkspaceCapture } from '../core/file-watcher';
import { CodingAgent, extractArtifacts } from '../agents/coding';
import { DecompositionAgent } from '../agents/decomposition';
import { MetaAgent } from '../agents/meta';
import { MergeAnalystAgent } from '../agents/merge-analyst';
import { ConflictResolverAgent } from '../agents/conflict-resolver';
import { LLMProvider } from '../llm/provider';
import { previewMerge, finalizeMerge, detectTestCommand, detectLintCommand } from '../core/merge';
import { Branch, Artifact, Message } from '../core/types';

export class ContextBranchView implements vscode.WebviewViewProvider {
  public static readonly viewType = 'contextbranch.sidebar';

  private view?: vscode.WebviewView;
  private currentAbort?: AbortController;
  private mergeInProgress?: boolean;

  constructor(
    private context: vscode.ExtensionContext,
    private getWorkspace: () => Workspace | null,
    private getProvider: () => LLMProvider | null,
    private getCondition: () => 'linear' | 'branched',
    private getStudyMode: () => boolean,
    private getCapture: () => WorkspaceCapture | null = () => null,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.file(path.join(this.context.extensionPath, 'webview')),
      ],
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg) => {
      try {
        await this.handleMessage(msg);
      } catch (err: any) {
        view.webview.postMessage({ type: 'error', message: err.message ?? String(err) });
      }
    });

    // Initial state push
    this.pushState();
  }

  // ─── outgoing helpers ─────────────────────────────────────────────────────

  private postMessage(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  pushState(): void {
    const ws = this.getWorkspace();
    if (!ws) {
      // No workspace folder open. Send a minimal state so the webview shows
      // a clear "open a folder" message rather than a broken-looking UI.
      this.postMessage({
        type: 'state',
        condition: this.getCondition(),
        providerReady: !!this.getProvider(),
        activeBranchId: null,
        mainBranchId: null,
        branches: [],
        messages: [],
        activeBranchName: '',
        activeBranchStatus: '',
        isMain: true,
        telemetry: null,
        noWorkspace: true,
      });
      return;
    }
    const branches = ws.getAllBranches();
    const activeId = ws.activeBranchId;
    const active = ws.getBranch(activeId)!;
    const messages = ws.getMessages(activeId);
    const checkpoints = ws.getCheckpoints(activeId);
    const condition = this.getCondition();
    const provider = this.getProvider();

    this.postMessage({
      type: 'state',
      condition,
      providerReady: !!provider,
      activeBranchId: activeId,
      mainBranchId: ws.mainBranchId,
      activeCheckpointId: active.activeCheckpointId ?? null,
      checkpoints: checkpoints.map(cp => ({
        id: cp.id,
        branchId: cp.branchId,
        parentCheckpointId: cp.parentCheckpointId,
        messageCount: cp.messageIds.length,
        artifactCount: cp.artifactIds.length,
        createdAt: cp.createdAt,
        label: cp.label,
      })),
      branches: branches.map(b => ({
        id: b.id, name: b.name, description: b.description,
        status: b.status, parentBranchId: b.parentBranchId,
        activeCheckpointId: b.activeCheckpointId ?? null,
        messageCount: b.messageIds.length, tags: b.tags,
      })),
      messages: messages.map(m => ({
        id: m.id, role: m.role, content: m.content, timestamp: m.timestamp,
      })),
      activeBranchName: active.name,
      activeBranchStatus: active.status,
      isMain: activeId === ws.mainBranchId,
      telemetry: ws.workspaceState.telemetry,
      noWorkspace: false,
    });
  }

  // ─── incoming message router ──────────────────────────────────────────────

  /** Returns the workspace or null + posts an error to the webview. */
  private requireWorkspace(): Workspace | null {
    const ws = this.getWorkspace();
    if (!ws) {
      this.postMessage({
        type: 'error',
        message: 'Open a folder first (File → Open Folder) and reload the window.',
      });
      return null;
    }
    return ws;
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg.type) {
      case 'send': return this.handleSend(msg.content);
      case 'createBranch': return this.handleCreateBranch(msg.name, msg.description, msg.fromMessageId);
      case 'switchBranch': return this.handleSwitchBranch(msg.branchId);
      case 'abandonBranch': return this.handleAbandonBranch(msg.branchId);
      case 'mergeBranch': return this.handleMergeBranch(msg.sourceBranchId, msg.targetBranchId, msg.force, msg.acceptedCascadePaths, msg.acceptedConflictPaths);
      case 'previewMerge': return this.handlePreviewMerge(msg.sourceBranchId, msg.targetBranchId);
      case 'createCheckpoint': return this.handleCreateCheckpoint(msg.branchId, msg.label);
      case 'restoreCheckpoint': return this.handleRestoreCheckpoint(msg.branchId, msg.checkpointId);
      case 'abortStream': return this.handleAbort();
      case 'decompose': return this.handleDecompose(msg.taskDescription);
      case 'requestState': return this.pushState();
      case 'applyArtifactsToWorkspace': return this.handleApplyArtifacts(msg.branchId);
    }
  }

  // ─── send message + stream reply ──────────────────────────────────────────

  private async handleSend(content: string): Promise<void> {
    const ws = this.requireWorkspace();
    if (!ws) return;
    const provider = this.getProvider();
    if (!provider) {
      this.postMessage({ type: 'error', message: 'No API key configured. Run "ContextBranch: Set API Key".' });
      return;
    }

    // Append user message
    const branch = ws.getActiveBranch();
    ws.appendMessage(branch.id, 'user', content);
    this.pushState();

    // Stream assistant reply
    this.currentAbort = new AbortController();
    const agent = new CodingAgent(provider);
    const parent = branch.parentBranchId ? ws.getBranch(branch.parentBranchId) : null;
    const history = ws.getMessages(branch.id);
    const isMain = branch.id === ws.mainBranchId;

    let assistantText = '';
    let inputTokens = 0, outputTokens = 0;
    let model: string | undefined;
    let aborted = false;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    this.postMessage({ type: 'streamStart' });

    try {
      for await (const ev of agent.streamReply({
        branch,
        parentBranchName: parent?.name ?? 'main',
        isMain,
        history,
        workspaceRoot,
        signal: this.currentAbort.signal,
        artifacts: ws.getArtifacts(branch.id),
      })) {
        if (ev.type === 'delta' && ev.text) {
          assistantText += ev.text;
          this.postMessage({ type: 'streamDelta', text: ev.text });
        } else if (ev.type === 'usage') {
          inputTokens = ev.inputTokens ?? 0;
          outputTokens = ev.outputTokens ?? 0;
        } else if (ev.type === 'error') {
          if (ev.error === 'aborted') {
            aborted = true;
            this.postMessage({ type: 'streamAborted' });
          } else {
            this.postMessage({ type: 'error', message: ev.error ?? 'Unknown LLM error' });
          }
          break;
        } else if (ev.type === 'done') {
          break;
        }
      }
    } finally {
      this.currentAbort = undefined;
    }

    // Persist assistant message (even if interrupted partway)
    if (assistantText) {
      const artifacts = extractArtifacts(assistantText);
      ws.appendMessage(branch.id, 'assistant', assistantText, {
        inputTokens, outputTokens, model,
        interrupted: aborted ? true : undefined,
        artifactIds: artifacts.length ? artifacts.map(a => a.path) : undefined,
      });

      // Save extracted artifacts (skip if aborted — partial code is unsafe)
      if (!aborted) {
        for (const a of artifacts) {
          const baseContent = readWorkspaceFile(workspaceRoot, a.path);
          ws.upsertArtifact(branch.id, a.path, a.content, baseContent);
        }
      }
    }

    this.postMessage({ type: 'streamEnd' });
    this.pushState();
  }

  private handleAbort(): void {
    this.currentAbort?.abort();
  }

  // ─── branching ────────────────────────────────────────────────────────────

  private handleCreateBranch(name: string, description?: string, fromMessageId?: string): void {
    if (this.getCondition() === 'linear') {
      this.postMessage({ type: 'error', message: 'Branching disabled in linear condition.' });
      return;
    }
    const ws = this.requireWorkspace();
    if (!ws) return;
    const branch = ws.createBranch({ name, description, fromMessageId });
    ws.switchBranch(branch.id);
    this.pushState();
  }

  private async handleSwitchBranch(branchId: string): Promise<void> {
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    const ws = this.requireWorkspace();
    if (!ws) return;

    const config = vscode.workspace.getConfiguration('contextbranch');
    const autoApply = config.get<boolean>('autoApplyOnSwitch') ?? true;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    // Capture the OLD branch's artifact paths so we can identify orphans
    // — files that exist on disk only because the old branch put them there
    //   and the new branch doesn't claim. Without this step, switching from
    //   branch-A (which created predict_v2.py) to branch-B (which doesn't)
    //   leaves predict_v2.py sitting on disk — not git-like.
    const oldBranchId = ws.activeBranchId;
    const oldPaths: Set<string> = new Set<string>(ws.getArtifacts(oldBranchId).map(a => a.path));

    ws.switchBranch(branchId);

    if (autoApply && workspaceRoot && oldBranchId !== branchId) {
      const newArtifacts = ws.getArtifacts(branchId);
      const sync = this.syncArtifactsToWorkspace(workspaceRoot, oldPaths, newArtifacts, 3000);

      if (sync.wrote > 0 || sync.removed > 0) {
        this.postMessage({
          type: 'switchApplied',
          wrote: sync.wrote,
          removed: sync.removed,
          branchName: ws.getBranch(branchId)?.name ?? branchId,
        });
      }
    }

    this.pushState();
  }

  private handleAbandonBranch(branchId: string): void {
    const ws = this.requireWorkspace();
    if (!ws) return;
    ws.abandonBranch(branchId);
    if (ws.activeBranchId === branchId) ws.switchBranch(ws.mainBranchId);
    this.pushState();
  }


  private syncArtifactsToWorkspace(workspaceRoot: string, oldPaths: Set<string>, newArtifacts: Artifact[], suppressMs = 3000): { wrote: number; removed: number } {
    const newPaths: Set<string> = new Set<string>(newArtifacts.map(a => a.path));
    const allTouchedAbs: string[] = [];
    for (const a of newArtifacts) allTouchedAbs.push(path.join(workspaceRoot, a.path));
    for (const op of oldPaths) allTouchedAbs.push(path.join(workspaceRoot, op));
    this.getCapture()?.suppressMany(allTouchedAbs, suppressMs);

    let wrote = 0, removed = 0;

    for (const art of newArtifacts) {
      try {
        const full = path.join(workspaceRoot, art.path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, art.content, 'utf-8');
        wrote++;
      } catch { /* skip unwriteable */ }
    }

    for (const orphanPath of oldPaths) {
      if (newPaths.has(orphanPath)) continue;
      try {
        const full = path.join(workspaceRoot, orphanPath);
        if (fs.existsSync(full)) {
          fs.unlinkSync(full);
          removed++;
        }
      } catch { /* skip */ }
    }

    return { wrote, removed };
  }

  private handleCreateCheckpoint(branchId: string, label?: string): void {
    const ws = this.requireWorkspace();
    if (!ws) return;
    const cp = ws.createCheckpoint(branchId, label);
    this.pushState();
    this.postMessage({
      type: 'checkpointCreated',
      checkpointId: cp.id,
      branchId,
      message: `Checkpoint created${cp.label ? `: ${cp.label}` : ''}.`,
    });
  }

  private handleRestoreCheckpoint(branchId: string, checkpointId: string): void {
    const ws = this.requireWorkspace();
    if (!ws) return;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const beforePaths: Set<string> = new Set<string>(ws.getArtifacts(branchId).map(a => a.path));
    const cp = ws.restoreCheckpoint(branchId, checkpointId);

    let wrote = 0;
    let removed = 0;
    if (workspaceRoot && ws.activeBranchId === branchId) {
      const afterArtifacts = ws.getArtifacts(branchId);
      const sync = this.syncArtifactsToWorkspace(workspaceRoot, beforePaths, afterArtifacts, 3000);
      wrote = sync.wrote;
      removed = sync.removed;
    }

    this.pushState();
    this.postMessage({
      type: 'checkpointRestored',
      branchId,
      checkpointId: cp.id,
      wrote,
      removed,
      message: `Restored checkpoint${cp.label ? `: ${cp.label}` : ''}.`,
    });
  }

  // ─── merging ──────────────────────────────────────────────────────────────

  /**
   * Build the analyzer hook passed into previewMerge. Captures `provider` and
   * returns a closure shaped like MergeOptions.analyzeCascade. Returns null
   * if no provider is available — caller skips passing the hook.
   */
  private buildAnalyzeCascadeHook(): NonNullable<Parameters<typeof previewMerge>[1]['analyzeCascade']> | null {
    const provider = this.getProvider();
    if (!provider) return null;
    const analyst = new MergeAnalystAgent(provider);
    return async (
      _source: Branch,
      _target: Branch,
      sourceArtifacts: Artifact[],
      targetArtifacts: Artifact[],
      changedFiles: { path: string; before: string; after: string; status: 'add' | 'modify' | 'conflict' }[],
      recentMessages: Message[],
    ) => {
      return await analyst.analyze({
        sourceArtifacts: sourceArtifacts.map(a => ({ path: a.path, content: a.content })),
        targetArtifacts: targetArtifacts.map(a => ({ path: a.path, content: a.content })),
        changedFiles,
        recentMessages: recentMessages.map(m => ({ role: m.role, content: m.content })),
        signal: this.currentAbort?.signal,
      });
    };
  }

  private buildResolveConflictHook(): NonNullable<Parameters<typeof previewMerge>[1]['resolveConflict']> | null {
    const provider = this.getProvider();
    if (!provider) return null;
    const resolver = new ConflictResolverAgent(provider);
    return async (opts) => {
      return await resolver.resolve({
        path: opts.path,
        base: opts.base,
        theirs: opts.theirs,
        ours: opts.ours,
        theirContext: opts.theirContext.map(m => ({ role: m.role, content: m.content })),
        ourContext: opts.ourContext.map(m => ({ role: m.role, content: m.content })),
        signal: this.currentAbort?.signal,
      });
    };
  }

  private async handlePreviewMerge(sourceBranchId: string, targetBranchId: string): Promise<void> {
    const ws = this.requireWorkspace();
    if (!ws) return;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = vscode.workspace.getConfiguration('contextbranch');
    const testCmd = config.get<string>('testCommand') || (workspaceRoot ? detectTestCommand(workspaceRoot) : null);
    const lintCmd = config.get<string>('lintCommand') || (workspaceRoot ? detectLintCommand(workspaceRoot) : null);
    const semanticMerge = config.get<boolean>('semanticMerge') ?? true;

    // Preview is intentionally FAST in the textual-diff path (~2s).
    // Cascading analysis adds an LLM call (~5-30s). It's the headline feature
    // so it's on by default; users can flip `contextbranch.semanticMerge`
    // to false for the linear/ablation condition in the study.
    try {
      const analyzeCascade = semanticMerge ? this.buildAnalyzeCascadeHook() : null;
      const resolveConflict = semanticMerge ? this.buildResolveConflictHook() : null;
      const preview = await previewMerge(ws, {
        sourceBranchId, targetBranchId,
        generateSynthesis: false,
        workspaceRoot,
        testCommand: testCmd ?? undefined,
        lintCommand: lintCmd ?? undefined,
        analyzeCascade: analyzeCascade ?? undefined,
        resolveConflict: resolveConflict ?? undefined,
      });
      this.postMessage({ type: 'mergePreview', preview, sourceBranchId, targetBranchId });
    } catch (err: any) {
      this.postMessage({ type: 'error', message: `Preview failed: ${err.message ?? err}` });
    }
  }

  private async handleMergeBranch(
    sourceBranchId: string,
    targetBranchId: string,
    force: boolean,
    acceptedCascadePaths?: string[],
    acceptedConflictPaths?: string[],
  ): Promise<void> {
    if (this.mergeInProgress) {
      this.postMessage({ type: 'error', message: 'A merge is already running.' });
      return;
    }
    const ws = this.requireWorkspace();
    if (!ws) return;
    const provider = this.getProvider();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const config = vscode.workspace.getConfiguration('contextbranch');
    const testCmd = config.get<string>('testCommand') || (workspaceRoot ? detectTestCommand(workspaceRoot) : null);
    const lintCmd = config.get<string>('lintCommand') || (workspaceRoot ? detectLintCommand(workspaceRoot) : null);
    const semanticMerge = config.get<boolean>('semanticMerge') ?? true;

    const meta = provider ? new MetaAgent(provider) : null;
    const analyzeCascade = semanticMerge ? this.buildAnalyzeCascadeHook() : null;
    const resolveConflict = semanticMerge ? this.buildResolveConflictHook() : null;

    const opts = {
      sourceBranchId, targetBranchId, force,
      generateSynthesis: true,
      workspaceRoot,
      testCommand: testCmd ?? undefined,
      lintCommand: lintCmd ?? undefined,
      consolidate: meta ? (b: Branch, msgs: Message[]) => meta.consolidate(b, msgs) : undefined,
      rebaseCheck: meta ? (s: Branch, t: Branch, sm: Message[], tm: Message[]) => meta.rebaseCheck(s, t, sm, tm) : undefined,
      consistencyCheck: meta ? (t: Branch, mm: Message[]) => meta.consistencyCheck(t, mm) : undefined,
      analyzeCascade: analyzeCascade ?? undefined,
      resolveConflict: resolveConflict ?? undefined,
      acceptedCascadePaths,
      acceptedConflictPaths,
    };

    this.mergeInProgress = true;
    try {
      const preview = await previewMerge(ws, opts);
      const event = await finalizeMerge(ws, opts, preview);

      if (ws.activeBranchId === sourceBranchId) ws.switchBranch(targetBranchId);
      this.pushState();
      this.postMessage({
        type: 'mergeCompleted',
        event,
        cascadingApplied: (acceptedCascadePaths ?? []).length,
        conflictsResolved: (acceptedConflictPaths ?? []).length,
      });
    } finally {
      this.mergeInProgress = false;
    }
  }

  // ─── decomposition ────────────────────────────────────────────────────────

  private async handleDecompose(taskDescription: string): Promise<void> {
    const provider = this.getProvider();
    if (!provider) {
      this.postMessage({ type: 'error', message: 'No API key.' });
      return;
    }
    const agent = new DecompositionAgent(provider);
    try {
      const result = await agent.decompose(taskDescription);
      this.postMessage({ type: 'decompositionResult', result });
    } catch (err: any) {
      this.postMessage({ type: 'error', message: err.message });
    }
  }

  // ─── apply artifacts ──────────────────────────────────────────────────────

  private async handleApplyArtifacts(branchId: string): Promise<void> {
    const ws = this.requireWorkspace();
    if (!ws) return;
    const branch = ws.getBranch(branchId);
    if (!branch) {
      this.postMessage({ type: 'error', message: 'Branch not found' });
      return;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.postMessage({ type: 'error', message: 'No workspace folder open' });
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Apply artifacts from "${branch.name}" to your workspace? This will overwrite files.`,
      { modal: true }, 'Apply', 'Cancel'
    );
    if (confirm !== 'Apply') return;

    const artifacts = ws.getArtifacts(branchId);
    // Suppress watcher around our writes
    const allAbs = artifacts.map(a => path.join(root, a.path));
    this.getCapture()?.suppressMany(allAbs, 3000);
    let count = 0;
    for (const art of artifacts) {
      const full = path.join(root, art.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, art.content, 'utf-8');
      count++;
    }
    vscode.window.showInformationMessage(`Wrote ${count} artifacts to workspace.`);
  }

  // ─── HTML scaffolding ─────────────────────────────────────────────────────

  private renderHtml(webview: vscode.Webview): string {
    const htmlPath = path.join(this.context.extensionPath, 'webview', 'index.html');
    const cssPath = vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'style.css'));
    const jsPath = vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'app.js'));
    const cssUri = webview.asWebviewUri(cssPath);
    const jsUri = webview.asWebviewUri(jsPath);
    const nonce = generateNonce();

    let html = fs.readFileSync(htmlPath, 'utf-8');
    html = html.replace(/\{\{cssUri\}\}/g, cssUri.toString());
    html = html.replace(/\{\{jsUri\}\}/g, jsUri.toString());
    html = html.replace(/\{\{nonce\}\}/g, nonce);
    html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
    return html;
  }
}

function generateNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function readWorkspaceFile(root: string | undefined, p: string): string | null {
  if (!root) return null;
  try {
    return fs.readFileSync(path.join(root, p), 'utf-8');
  } catch { return null; }
}