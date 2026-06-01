/**
 * Content-addressable storage with atomic writes.
 *
 * Layout under .contextbranch/ in the workspace root:
 *   workspace.json          — top-level WorkspaceState
 *   objects/<hash>.json     — content-addressed messages, artifacts, checkpoints
 *   branches/<id>.json      — branch metadata
 *   tasks/<id>.json         — task / merge-plan metadata
 *   merges/<id>.json        — merge events
 *   telemetry/<ts>.jsonl    — append-only telemetry log
 *
 * Every write goes to <path>.tmp first then renames atomically. On VS Code
 * crash this means we either have the old file or the new file, never a half-
 * written one.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  WorkspaceState, Branch, Message, Artifact, Checkpoint,
  Task, MergeEvent
} from './types';

export class Storage {
  constructor(private root: string) {
    this.ensureDirs();
  }

  private ensureDirs(): void {
    const dirs = [
      this.root,
      path.join(this.root, 'objects'),
      path.join(this.root, 'branches'),
      path.join(this.root, 'tasks'),
      path.join(this.root, 'merges'),
      path.join(this.root, 'telemetry'),
    ];
    for (const d of dirs) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }
  }

  // ─── atomic write helpers ─────────────────────────────────────────────────

  private writeAtomic(filePath: string, data: string): void {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, data, 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  private readJson<T>(filePath: string): T | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  // ─── hashing ──────────────────────────────────────────────────────────────

  static hash(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 32);
  }

  // ─── workspace ────────────────────────────────────────────────────────────

  loadWorkspace(): WorkspaceState | null {
    return this.readJson<WorkspaceState>(path.join(this.root, 'workspace.json'));
  }

  saveWorkspace(state: WorkspaceState): void {
    this.writeAtomic(path.join(this.root, 'workspace.json'), JSON.stringify(state, null, 2));
  }

  // ─── content-addressed objects ────────────────────────────────────────────

  saveMessage(msg: Message): void {
    const file = path.join(this.root, 'objects', `m_${msg.id}.json`);
    if (fs.existsSync(file)) return; // dedup
    this.writeAtomic(file, JSON.stringify(msg));
  }

  loadMessage(id: string): Message | null {
    return this.readJson<Message>(path.join(this.root, 'objects', `m_${id}.json`));
  }

  saveArtifact(art: Artifact): void {
    const file = path.join(this.root, 'objects', `a_${art.id}.json`);
    this.writeAtomic(file, JSON.stringify(art));
  }

  loadArtifact(id: string): Artifact | null {
    return this.readJson<Artifact>(path.join(this.root, 'objects', `a_${id}.json`));
  }

  saveCheckpoint(cp: Checkpoint): void {
    const file = path.join(this.root, 'objects', `c_${cp.id}.json`);
    if (fs.existsSync(file)) return; // dedup
    this.writeAtomic(file, JSON.stringify(cp));
  }

  loadCheckpoint(id: string): Checkpoint | null {
    return this.readJson<Checkpoint>(path.join(this.root, 'objects', `c_${id}.json`));
  }

  loadAllCheckpoints(): Checkpoint[] {
    const dir = path.join(this.root, 'objects');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('c_') && f.endsWith('.json') && !f.endsWith('.tmp'))
      .map(f => this.readJson<Checkpoint>(path.join(dir, f)))
      .filter((cp): cp is Checkpoint => cp !== null);
  }

  // ─── branches ─────────────────────────────────────────────────────────────

  saveBranch(b: Branch): void {
    const file = path.join(this.root, 'branches', `${b.id}.json`);
    this.writeAtomic(file, JSON.stringify(b, null, 2));
  }

  loadBranch(id: string): Branch | null {
    return this.readJson<Branch>(path.join(this.root, 'branches', `${id}.json`));
  }

  loadAllBranches(): Branch[] {
    const dir = path.join(this.root, 'branches');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map(f => this.readJson<Branch>(path.join(dir, f)))
      .filter((b): b is Branch => b !== null);
  }

  deleteBranch(id: string): void {
    const file = path.join(this.root, 'branches', `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }

  // ─── tasks ────────────────────────────────────────────────────────────────

  saveTask(t: Task): void {
    this.writeAtomic(path.join(this.root, 'tasks', `${t.id}.json`), JSON.stringify(t, null, 2));
  }

  loadTask(id: string): Task | null {
    return this.readJson<Task>(path.join(this.root, 'tasks', `${id}.json`));
  }

  loadAllTasks(): Task[] {
    const dir = path.join(this.root, 'tasks');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map(f => this.readJson<Task>(path.join(dir, f)))
      .filter((t): t is Task => t !== null);
  }

  // ─── merge events ─────────────────────────────────────────────────────────

  saveMergeEvent(m: MergeEvent): void {
    this.writeAtomic(path.join(this.root, 'merges', `${m.id}.json`), JSON.stringify(m, null, 2));
  }

  loadMergeEvent(id: string): MergeEvent | null {
    return this.readJson<MergeEvent>(path.join(this.root, 'merges', `${id}.json`));
  }

  loadAllMergeEvents(): MergeEvent[] {
    const dir = path.join(this.root, 'merges');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json') && !f.endsWith('.tmp'))
      .map(f => this.readJson<MergeEvent>(path.join(dir, f)))
      .filter((m): m is MergeEvent => m !== null);
  }

  // ─── telemetry (append-only JSONL) ────────────────────────────────────────

  appendTelemetry(event: Record<string, unknown>): void {
    const day = new Date().toISOString().slice(0, 10);
    const file = path.join(this.root, 'telemetry', `${day}.jsonl`);
    const line = JSON.stringify({ ts: Date.now(), ...event }) + '\n';
    fs.appendFileSync(file, line);
  }

  loadTelemetry(): Record<string, unknown>[] {
    const dir = path.join(this.root, 'telemetry');
    if (!fs.existsSync(dir)) return [];
    const events: Record<string, unknown>[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const lines = fs.readFileSync(path.join(dir, f), 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    }
    return events;
  }

  // ─── reset (study mode helper) ────────────────────────────────────────────

  reset(): void {
    if (fs.existsSync(this.root)) {
      fs.rmSync(this.root, { recursive: true, force: true });
    }
    this.ensureDirs();
  }
}