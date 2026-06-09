/**
 * change-decorations.ts — git-style change preview + "what just changed" markers.
 *
 * Two phases:
 *
 *  PREVIEW (before Apply):
 *    We apply the proposed content to the in-memory document as a REAL but
 *    UNSAVED edit (a WorkspaceEdit). The new/changed lines therefore exist at
 *    their correct positions, and we paint a green gutter + line background on
 *    exactly those lines. Because it's an unsaved buffer edit (not a disk
 *    write), the file-watcher never sees it.
 *      • Apply   → save the document (commitPreview).
 *      • Dismiss → revert the document to its saved state (dismissPreview).
 *      • Click a previewed line → that single added line is removed from the
 *        buffer and its highlight drops (per-line dismiss).
 *
 *  APPLIED (after Apply, e.g. branch switch writes straight to disk):
 *    We diff before→after and paint the same green markers on the added lines,
 *    persisting until the user edits the file.
 */

import * as vscode from 'vscode';
import { diffLines, DiffHunk } from './edits';

/** 0-based line numbers on the AFTER side that are added (insert or replace). */
function addedLineNumbers(hunks: DiffHunk[]): number[] {
  const added: number[] = [];
  for (const h of hunks) {
    let afterLine = h.afterStart;
    for (const ln of h.lines) {
      if (ln.type === 'add') { added.push(afterLine); afterLine++; }
      else if (ln.type === 'ctx') { afterLine++; }
      // 'del' lines don't exist on the after side.
    }
  }
  return added;
}

interface PreviewSession {
  /** Saved-on-disk text we reverted FROM, so Dismiss can restore it. */
  savedText: string;
  /** 0-based line numbers in the CURRENT buffer that are previewed additions.
   *  Kept sorted ascending. Mutated as the user dismisses individual lines. */
  lines: number[];
}

export class ChangeDecorations {
  /** Green gutter + faint background for added / changed lines. */
  private readonly addedDecoration: vscode.TextEditorDecorationType;

  /** fsPath -> applied (post-write) highlight line numbers. */
  private readonly pending = new Map<string, number[]>();

  /** fsPath -> active preview session. */
  private readonly previews = new Map<string, PreviewSession>();

  /** Snapshots taken before a disk write, to diff after. fsPath -> content. */
  private readonly beforeSnapshots = new Map<string, string>();

  /** fsPath -> expiry ms: ignore the document-reload our own disk write causes. */
  private readonly selfWrite = new Map<string, number>();

  /** Guard so our own preview buffer edits don't trip the auto-clear handler. */
  private applyingPreviewEdit = false;

  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.addedDecoration = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      overviewRulerColor: new vscode.ThemeColor('minimapGutter.addedBackground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editorGutter.addedBackground'),
    });

    // Re-paint when an editor (re)appears.
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        for (const e of editors) this.refresh(e);
      }),
    );

    // Click-to-dismiss a single previewed line.
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection(e => {
        const key = e.textEditor.document.uri.fsPath;
        const session = this.previews.get(key);
        if (!session) return;
        // Only react to a genuine click/caret move, not programmatic edits.
        if (e.kind === undefined) return;
        const line = e.selections[0]?.active.line;
        if (line === undefined) return;
        if (session.lines.includes(line)) {
          void this.dismissLine(key, line);
        }
      }),
    );

    // Clear APPLIED markers once the user edits the file. Ignore (a) the reload
    // from our own disk write and (b) our own preview buffer edits.
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        const key = e.document.uri.fsPath;
        if (this.applyingPreviewEdit) return;
        if (this.previews.has(key)) return; // preview edits are managed explicitly
        if (!this.pending.has(key) || e.contentChanges.length === 0) return;
        if (this.isSelfWrite(key)) return;
        this.clearFile(key);
      }),
    );
  }

  // ─── PREVIEW (before apply) ───────────────────────────────────────────────

  /**
   * Show the proposed `afterContent` in the real file as an unsaved edit and
   * highlight the added/changed lines. Returns true if anything was previewed.
   */
  async previewChanges(absPath: string, afterContent: string, opts: { reveal?: boolean } = {}): Promise<boolean> {
    const uri = vscode.Uri.file(absPath);
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return false; // new file that doesn't exist yet, etc.
    }

    const before = doc.getText();
    if (before === afterContent) { this.clearFile(absPath); return false; }

    const lines = addedLineNumbers(diffLines(before, afterContent));
    if (lines.length === 0) { this.clearFile(absPath); return false; }

    // Replace the whole document with the proposed content (unsaved).
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(before.length),
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, afterContent);

    this.applyingPreviewEdit = true;
    let ok = false;
    try {
      ok = await vscode.workspace.applyEdit(edit);
    } finally {
      this.applyingPreviewEdit = false;
    }
    if (!ok) return false;

    this.previews.set(absPath, { savedText: before, lines: [...lines].sort((a, b) => a - b) });
    this.pending.delete(absPath);

    // Open (if needed) and paint live — no manual reopen required.
    await this.paint(absPath, { open: true, reveal: opts.reveal });
    return true;
  }

  /** Apply: persist the previewed buffer to disk and switch to solid markers. */
  async commitPreview(absPath: string): Promise<boolean> {
    const session = this.previews.get(absPath);
    if (!session) return false;
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === absPath);
    if (!doc) { this.previews.delete(absPath); return false; }

    this.noteSelfWrite(absPath, 4000);
    const saved = await doc.save();
    const keptLines = session.lines.slice();
    this.previews.delete(absPath);

    // The remaining previewed lines become the persistent "just changed" set.
    if (keptLines.length) {
      this.pending.set(absPath, keptLines);
      await this.paint(absPath, { open: true });
    } else {
      this.clearFile(absPath);
    }
    return saved;
  }

  /** Dismiss: revert the whole preview back to the saved file. */
  async dismissPreview(absPath: string): Promise<void> {
    const session = this.previews.get(absPath);
    if (!session) return;
    const uri = vscode.Uri.file(absPath);
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === absPath);
    this.previews.delete(absPath);
    if (!doc) return;

    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, session.savedText);
    this.applyingPreviewEdit = true;
    try {
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.applyingPreviewEdit = false;
    }
    this.clearFile(absPath);
  }

  /** Dismiss a single previewed added line: delete it from the buffer. */
  private async dismissLine(absPath: string, line: number): Promise<void> {
    const session = this.previews.get(absPath);
    if (!session) return;
    const uri = vscode.Uri.file(absPath);
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === absPath);
    if (!doc || line < 0 || line >= doc.lineCount) return;

    // Delete the whole line including its trailing newline.
    const start = new vscode.Position(line, 0);
    const end = line + 1 < doc.lineCount
      ? new vscode.Position(line + 1, 0)
      : doc.lineAt(line).range.end;
    const edit = new vscode.WorkspaceEdit();
    edit.delete(uri, new vscode.Range(start, end));

    this.applyingPreviewEdit = true;
    try {
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.applyingPreviewEdit = false;
    }

    // Drop this line, shift every later previewed line up by one.
    session.lines = session.lines
      .filter(n => n !== line)
      .map(n => (n > line ? n - 1 : n));

    if (session.lines.length === 0) {
      // Nothing left to preview — but keep whatever the user has now (their
      // partial accept) as unsaved. Just clear the session + decorations.
      this.previews.delete(absPath);
      this.clearFile(absPath);
      return;
    }
    await this.paint(absPath);
  }

  /** Is there an active preview for this file? */
  hasPreview(absPath: string): boolean {
    return this.previews.has(absPath);
  }

  /** Revert every active preview (e.g. before a branch switch). */
  async dismissAllPreviews(): Promise<void> {
    for (const absPath of Array.from(this.previews.keys())) {
      await this.dismissPreview(absPath);
    }
  }

  // ─── APPLIED (after a direct disk write) ──────────────────────────────────

  /** Record on-disk content right before overwriting `absPath`. */
  snapshotBefore(absPath: string): void {
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === absPath);
    if (doc) { this.beforeSnapshots.set(absPath, doc.getText()); return; }
    try {
      const fs = require('fs') as typeof import('fs');
      this.beforeSnapshots.set(absPath, fs.readFileSync(absPath, 'utf-8'));
    } catch {
      this.beforeSnapshots.set(absPath, '');
    }
  }

  /** After a disk write: diff and paint persistent markers on added lines. */
  async markChanges(absPath: string, afterContent: string, opts: { reveal?: boolean } = {}): Promise<void> {
    this.noteSelfWrite(absPath);
    this.previews.delete(absPath);

    const before = this.beforeSnapshots.get(absPath) ?? '';
    this.beforeSnapshots.delete(absPath);
    if (before === afterContent) { this.clearFile(absPath); return; }

    const lines = addedLineNumbers(diffLines(before, afterContent));
    if (lines.length === 0) { this.clearFile(absPath); return; }
    this.pending.set(absPath, lines);

    await this.paint(absPath, { open: true, reveal: opts.reveal });
  }

  // ─── painting ─────────────────────────────────────────────────────────────

  /**
   * Ensure the file's editor is open and its decorations are applied — now,
   * and again on the next ticks. The re-applies matter because right after a
   * buffer edit / save / open, VS Code may not have finished laying out the
   * editor, so a single setDecorations call can land on a transient state and
   * not visibly stick (the "had to close and reopen the file" symptom). We
   * paint immediately, then again shortly after, so it always shows live.
   */
  private async paint(absPath: string, opts: { open?: boolean; reveal?: boolean } = {}): Promise<void> {
    let editor = vscode.window.visibleTextEditors.find(ed => ed.document.uri.fsPath === absPath);

    if (!editor && opts.open) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absPath));
        // preserveFocus so opening a background file doesn't yank the user around
        // when we're painting several files at once.
        editor = await vscode.window.showTextDocument(doc, {
          preview: false,
          preserveFocus: !opts.reveal,
        });
      } catch { /* can't open (e.g. brand-new path) — nothing to paint */ }
    }
    if (!editor) return;

    this.refresh(editor);

    if (opts.reveal) {
      const lines = this.linesFor(absPath);
      if (lines.length) {
        editor.revealRange(
          new vscode.Range(lines[0], 0, lines[0], 0),
          vscode.TextEditorRevealType.InCenterIfOutsideViewport,
        );
      }
    }

    // Re-apply across a couple of frames so the decorations survive VS Code's
    // post-edit/post-open relayout without needing a manual file reopen.
    const reapply = () => {
      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === absPath);
      if (ed) this.refresh(ed);
    };
    setTimeout(reapply, 0);
    setTimeout(reapply, 60);
    setTimeout(reapply, 200);
  }

  /** The line numbers currently associated with a file (preview or applied). */
  private linesFor(absPath: string): number[] {
    const session = this.previews.get(absPath);
    return session ? session.lines : (this.pending.get(absPath) ?? []);
  }

  private refresh(editor: vscode.TextEditor): void {
    const key = editor.document.uri.fsPath;
    const max = editor.document.lineCount - 1;
    const session = this.previews.get(key);
    const lines = session ? session.lines : (this.pending.get(key) ?? []);
    const ranges = lines
      .filter(n => n >= 0 && n <= max)
      .map(n => new vscode.Range(n, 0, n, 0));
    editor.setDecorations(this.addedDecoration, ranges);
  }

  // ─── self-write guard ─────────────────────────────────────────────────────

  noteSelfWrite(absPath: string, ttlMs = 1500): void {
    this.selfWrite.set(absPath, Date.now() + ttlMs);
  }

  private isSelfWrite(absPath: string): boolean {
    const expiry = this.selfWrite.get(absPath);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) { this.selfWrite.delete(absPath); return false; }
    return true;
  }

  // ─── clearing ───────────────────────────────────────────────────────────

  clearFile(absPath: string): void {
    this.pending.delete(absPath);
    const open = vscode.window.visibleTextEditors.find(ed => ed.document.uri.fsPath === absPath);
    if (open) open.setDecorations(this.addedDecoration, []);
  }

  clearAll(): void {
    const paths = new Set<string>([...this.pending.keys(), ...this.previews.keys()]);
    this.pending.clear();
    this.previews.clear();
    for (const p of paths) {
      const open = vscode.window.visibleTextEditors.find(ed => ed.document.uri.fsPath === p);
      if (open) open.setDecorations(this.addedDecoration, []);
    }
  }

  dispose(): void {
    this.addedDecoration.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.pending.clear();
    this.previews.clear();
    this.beforeSnapshots.clear();
  }
}