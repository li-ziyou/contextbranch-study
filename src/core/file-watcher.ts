/**
 * WorkspaceCapture — watches the workspace for user edits and creations of
 * files that aren't part of the AI conversation, and folds them into the
 * active branch as artifacts.
 *
 * Why this matters: without this, branches only "see" the files the AI wrote
 * via the // path: convention. The user can edit a file in the editor, save
 * it, and the branch has no idea — leading to merge ghosts ("I edited X but
 * the merge says X is unchanged"). With this watcher on, every save the
 * user makes to a file matching an existing artifact updates that artifact;
 * every newly-created file under the workspace gets claimed into the
 * active branch.
 *
 * Edge cases handled:
 *   • Our own writes (Apply Artifacts, switchApplied) would re-trigger the
 *     watcher → infinite loop. We track "suppressedPaths" set + a short
 *     cooldown to ignore changes we caused ourselves.
 *   • .contextbranch/, .git/, node_modules/, dist/, .venv/, __pycache__ are
 *     ignored — these aren't source files the user is editing.
 *   • Binary files (>1MB or non-UTF8) are skipped.
 *
 * This is enabled via `contextbranch.captureUserEdits` — default true for
 * existing-artifact edits, false for new-file claims (which is more
 * surprising behavior).
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Workspace } from './workspace';

const IGNORED_DIR_SEGMENTS = new Set([
  '.contextbranch',
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.venv',
  'venv',
  '__pycache__',
  '.next',
  '.cache',
  '.idea',
  '.vscode',
]);

const IGNORED_EXTENSIONS = new Set([
  '.lock', '.log', '.pid', '.swp', '.tmp',
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
]);

const MAX_CAPTURE_BYTES = 1_000_000; // 1MB

export class WorkspaceCapture implements vscode.Disposable {
  private watcher?: vscode.FileSystemWatcher;
  private suppressed = new Map<string, number>(); // absPath -> expires-at ms
  private disposables: vscode.Disposable[] = [];

  constructor(
    private workspaceRoot: string,
    private getWorkspace: () => Workspace | null,
    private onCaptured: () => void, // typically calls view.pushState()
  ) {}

  start(): void {
    if (this.watcher) return;
    // We listen for any file change/create/delete in the workspace.
    // Excludes are handled in the path filter below — the createFileSystemWatcher
    // glob pattern doesn't support exclusions cleanly, so we filter manually.
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.disposables.push(
      this.watcher,
      this.watcher.onDidChange(uri => this.handleChange(uri)),
      this.watcher.onDidCreate(uri => this.handleCreate(uri)),
      this.watcher.onDidDelete(uri => this.handleDelete(uri)),
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.watcher = undefined;
  }

  /**
   * Mark a path as "we just wrote to this, ignore the resulting watcher fire".
   * Call this BEFORE writing to disk yourself (Apply Artifacts, switch apply).
   * The suppression auto-expires after 2s to handle async filesystem delays.
   */
  suppress(absPath: string, ttlMs = 2000): void {
    this.suppressed.set(absPath, Date.now() + ttlMs);
  }

  suppressMany(absPaths: string[], ttlMs = 2000): void {
    for (const p of absPaths) this.suppress(p, ttlMs);
  }

  // ─── handlers ──────────────────────────────────────────────────────────

  private async handleChange(uri: vscode.Uri): Promise<void> {
    if (!this.shouldCapture(uri)) return;
    const config = vscode.workspace.getConfiguration('contextbranch');
    if (!(config.get<boolean>('captureUserEdits') ?? true)) return;

    const ws = this.getWorkspace();
    if (!ws) return;

    const relPath = this.relativize(uri.fsPath);
    if (!relPath) return;

    // Only update if there's an existing artifact at this path on the
    // active branch — user edited an AI-generated file. New-file claims
    // go through handleCreate. #MODIFIED
    const artifacts = ws.getArtifacts(ws.activeBranchId);
    const existing = artifacts.find(a => a.path === relPath);
    const newContent = this.readSafe(uri.fsPath);
if (newContent === null) return;

/**
 * NEW FILE CLAIM PATH
 * Some VS Code save flows emit onDidChange instead of onDidCreate
 * for newly created files. If captureNewFiles is enabled, claim
 * the file here so it becomes branch-owned.
 */
if (!existing) {
  const captureNew = config.get<boolean>('captureNewFiles') ?? true;
  if (!captureNew) return;

  ws.upsertArtifact(
    ws.activeBranchId,
    relPath,
    newContent,
    null,
    'merge'
  );

  ws.storage.appendTelemetry({
    type: 'user_create_captured',
    branchId: ws.activeBranchId,
    path: relPath,
    bytes: newContent.length,
  });

  this.onCaptured();
  return;
}

/**
 * EXISTING FILE UPDATE PATH
 */
if (newContent === existing.content) return;

ws.upsertArtifact(
  ws.activeBranchId,
  relPath,
  newContent,
  existing.content,
  'merge'
);

ws.storage.appendTelemetry({
  type: 'user_edit_captured',
  branchId: ws.activeBranchId,
  path: relPath,
  bytes: newContent.length,
});

this.onCaptured();
  }

  private async handleCreate(uri: vscode.Uri): Promise<void> {
    if (!this.shouldCapture(uri)) return;
    const config = vscode.workspace.getConfiguration('contextbranch');
    if (!(config.get<boolean>('captureNewFiles') ?? true)) return;

    const ws = this.getWorkspace();
    if (!ws) return;

    const relPath = this.relativize(uri.fsPath);
    if (!relPath) return;

    const artifacts = ws.getArtifacts(ws.activeBranchId);
    if (artifacts.some(a => a.path === relPath)) return; // already an artifact

    const content = this.readSafe(uri.fsPath);
    if (content === null) return;

    ws.upsertArtifact(ws.activeBranchId, relPath, content, null, 'merge');
    ws.storage.appendTelemetry({
      type: 'user_create_captured',
      branchId: ws.activeBranchId, path: relPath, bytes: content.length,
    });
    this.onCaptured();
  }

  private handleDelete(uri: vscode.Uri): void {
    // shouldCapture also rejects suppressed paths — so our OWN orphan-deletes
    // during branch switch / checkpoint restore (which suppressMany the touched
    // paths) never reach here. Only genuine user deletes do.
    if (!this.shouldCapture(uri)) return;
    const ws = this.getWorkspace();
    if (!ws) return;
    const relPath = this.relativize(uri.fsPath);
    if (!relPath) return;

    ws.storage.appendTelemetry({
      type: 'workspace_delete_observed',
      branchId: ws.activeBranchId, path: relPath,
    });

    const config = vscode.workspace.getConfiguration('contextbranch');
    if (!(config.get<boolean>('captureUserEdits') ?? true)) return;

    // Only act when this path is actually an artifact (file) or contains
    // artifacts (folder). Stray temp-file deletes that were never artifacts
    // become harmless no-ops — that's why this is safe to enable.
    const prefix = relPath + '/';
    const arts = ws.getArtifacts(ws.activeBranchId);
    const affected = arts.some(a => a.path === relPath || a.path.startsWith(prefix));
    if (!affected) return;

    const removed = ws.removeArtifactsByPath(ws.activeBranchId, relPath);
    if (removed.length) {
      ws.storage.appendTelemetry({
        type: 'workspace_delete_applied',
        branchId: ws.activeBranchId, path: relPath,
      });
      this.onCaptured();
    }
  }

  /**
   * One-time import of files that already exist in the workspace when the
   * project is first initialized, so the starting state of an existing folder
   * becomes artifacts on the active branch. Idempotent: skips paths that are
   * already artifacts. Returns the number of files imported.
   */
  ingestExisting(): number {
    const ws = this.getWorkspace();
    if (!ws) return 0;
    let count = 0;
    const existingPaths = new Set(ws.getArtifacts(ws.activeBranchId).map(a => a.path));

    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { return; }
      for (const ent of entries) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (IGNORED_DIR_SEGMENTS.has(ent.name)) continue;
          walk(abs);
        } else if (ent.isFile()) {
          const uri = vscode.Uri.file(abs);
          if (!this.shouldCapture(uri)) continue;       // ext / ignore filters
          const rel = this.relativize(abs);
          if (!rel || existingPaths.has(rel)) continue;
          const content = this.readSafe(abs);
          if (content === null) continue;               // binary / too big
          ws.upsertArtifact(ws.activeBranchId, rel, content, null, 'merge');
          ws.storage.appendTelemetry({
            type: 'project_ingested',
            branchId: ws.activeBranchId, path: rel, bytes: content.length,
          });
          existingPaths.add(rel);
          count++;
        }
      }
    };
    walk(this.workspaceRoot);
    if (count) this.onCaptured();
    return count;
  }

  // ─── filters ───────────────────────────────────────────────────────────

  private shouldCapture(uri: vscode.Uri): boolean {
    if (uri.scheme !== 'file') return false;
    const abs = uri.fsPath;
    if (this.isSuppressed(abs)) return false;

    const rel = path.relative(this.workspaceRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false; // outside workspace

    // Reject any path component in the ignore list.
    const segments = rel.split(path.sep);
    for (const seg of segments) {
      if (IGNORED_DIR_SEGMENTS.has(seg)) return false;
      if (seg.startsWith('.') && IGNORED_DIR_SEGMENTS.has(seg)) return false;
    }

    const ext = path.extname(rel).toLowerCase();
    if (IGNORED_EXTENSIONS.has(ext)) return false;

    return true;
  }

  private isSuppressed(absPath: string): boolean {
    const expiry = this.suppressed.get(absPath);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.suppressed.delete(absPath);
      return false;
    }
    return true;
  }

  private relativize(absPath: string): string | null {
    const rel = path.relative(this.workspaceRoot, absPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    // Normalize to forward slashes for cross-platform artifact path consistency.
    return rel.split(path.sep).join('/');
  }

  private readSafe(absPath: string): string | null {
    try {
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) return null;
      if (stat.size > MAX_CAPTURE_BYTES) return null;
      const buf = fs.readFileSync(absPath);
      // Quick UTF-8 validity check: try decoding and see if we get U+FFFD chars.
      const str = buf.toString('utf-8');
      // If it's mostly non-printable, treat as binary.
      const nonPrintable = (str.match(/[\x00-\x08\x0E-\x1F]/g) || []).length;
      if (nonPrintable > str.length * 0.05) return null;
      return str;
    } catch {
      return null;
    }
  }
}
