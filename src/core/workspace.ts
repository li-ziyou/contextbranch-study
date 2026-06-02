/**
 * Workspace orchestrates all branch / message / checkpoint operations.
 *
 * Holds an in-memory cache for performance and writes through to Storage
 * for persistence + crash safety.
 */

import { Storage } from './storage';
import {
  Branch, Message, Artifact, Checkpoint, WorkspaceState, BranchStatus,
  MergeEvent
} from './types';

export class Workspace {
  private state: WorkspaceState;
  private branchCache = new Map<string, Branch>();

  constructor(public storage: Storage) {
    const existing = storage.loadWorkspace();
    if (existing) {
      this.state = existing;
      // warm cache
      for (const id of this.state.branchIds) {
        const b = this.storage.loadBranch(id);
        if (b) this.branchCache.set(id, b);
      }
    } else {
      this.state = this.bootstrap();
    }
  }

  // ─── bootstrap ────────────────────────────────────────────────────────────

  private bootstrap(): WorkspaceState {
    const mainId = 'main';
    const main: Branch = {
      id: mainId,
      name: 'main',
      description: 'Root conversation',
      parentBranchId: null,
      parentCheckpointId: null,
      activeCheckpointId: null,
      forkedAtMessageCount: 0,
      messageIds: [],
      artifactIds: [],
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.branchCache.set(mainId, main);
    this.storage.saveBranch(main);

    const state: WorkspaceState = {
      version: 1,
      createdAt: Date.now(),
      activeBranchId: mainId,
      mainBranchId: mainId,
      branchIds: [mainId],
      taskIds: [],
      mergeEventIds: [],
      telemetry: {
        sessionStartedAt: Date.now(),
        totalApiCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      },
    };
    this.storage.saveWorkspace(state);
    return state;
  }

  // ─── accessors ────────────────────────────────────────────────────────────

  get activeBranchId(): string { return this.state.activeBranchId; }
  get mainBranchId(): string { return this.state.mainBranchId; }
  get workspaceState(): WorkspaceState { return this.state; }

  getBranch(id: string): Branch | null {
    const cached = this.branchCache.get(id);
    if (cached) return this.ensureBranchCheckpointState(cached);
    const loaded = this.storage.loadBranch(id);
    if (loaded) {
      this.ensureBranchCheckpointState(loaded);
      this.branchCache.set(id, loaded);
    }
    return loaded;
  }

  getAllBranches(): Branch[] {
    return this.state.branchIds
      .map(id => this.getBranch(id))
      .filter((b): b is Branch => b !== null);
  }

  getActiveBranch(): Branch {
    const b = this.getBranch(this.activeBranchId);
    if (!b) throw new Error('Active branch missing');
    return b;
  }

  getMessage(id: string): Message | null {
    return this.storage.loadMessage(id);
  }

  getMessages(branchId: string): Message[] {
    const b = this.getBranch(branchId);
    if (!b) return [];
    return b.messageIds
      .map(id => this.storage.loadMessage(id))
      .filter((m): m is Message => m !== null);
  }

  getArtifacts(branchId: string): Artifact[] {
    const b = this.getBranch(branchId);
    if (!b) return [];
    return b.artifactIds
      .map(id => this.storage.loadArtifact(id))
      .filter((a): a is Artifact => a !== null);
  }

  getCheckpoint(id: string): Checkpoint | null {
    return this.storage.loadCheckpoint(id);
  }

  getAllCheckpoints(): Checkpoint[] {
    return this.storage.loadAllCheckpoints().sort((a, b) => a.createdAt - b.createdAt);
  }

  getCheckpoints(branchId: string): Checkpoint[] {
    return this.getAllCheckpoints().filter(cp => cp.branchId === branchId);
  }

  // ─── persistence helpers ──────────────────────────────────────────────────

  private save(): void {
    this.storage.saveWorkspace(this.state);
  }

  private saveBranch(b: Branch): void {
    b.updatedAt = Date.now();
    this.branchCache.set(b.id, b);
    this.storage.saveBranch(b);
  }

  private ensureBranchCheckpointState(branch: Branch): Branch {
    const typed = branch as Branch & { activeCheckpointId?: string | null };
    if (typed.activeCheckpointId === undefined) {
      typed.activeCheckpointId = this.resolveLegacyActiveCheckpointId(branch);
      this.saveBranch(branch);
    }
    return branch;
  }

  private resolveLegacyActiveCheckpointId(branch: Branch): string | null {
    const checkpoints = this.storage.loadAllCheckpoints().filter(cp => cp.branchId === branch.id);
    if (checkpoints.length === 0) {
      return branch.parentCheckpointId ?? null;
    }

    const sameState = checkpoints.find(cp =>
      this.arraysEqual(cp.messageIds, branch.messageIds) &&
      this.arraysEqual(cp.artifactIds, branch.artifactIds)
    );
    if (sameState) return sameState.id;

    const sorted = checkpoints.slice().sort((a, b) => a.createdAt - b.createdAt);
    return sorted.length ? sorted[sorted.length - 1].id : (branch.parentCheckpointId ?? null);
  }

  private arraysEqual<T>(a: T[], b: T[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // ─── messages ─────────────────────────────────────────────────────────────

  appendMessage(branchId: string, role: Message['role'], content: string,
                meta?: Message['meta']): Message {
    const b = this.getBranch(branchId);
    if (!b) throw new Error(`Branch ${branchId} not found`);
    if (b.status === 'merged' || b.status === 'abandoned') {
      throw new Error(`Cannot append to ${b.status} branch ${branchId}`);
    }

    const ts = Date.now();
    const id = Storage.hash(`${role}|${content}|${ts}|${branchId}`);
    const msg: Message = { id, role, content, timestamp: ts, meta };
    this.storage.saveMessage(msg);

    b.messageIds.push(id);
    if (b.status === 'draft') b.status = 'active';
    this.saveBranch(b);

    if (meta?.inputTokens || meta?.outputTokens) {
      this.state.telemetry.totalApiCalls += 1;
      this.state.telemetry.totalInputTokens += meta.inputTokens ?? 0;
      this.state.telemetry.totalOutputTokens += meta.outputTokens ?? 0;
      this.save();
    }

    this.storage.appendTelemetry({
      type: 'message_appended', branchId, role, msgId: id,
      inputTokens: meta?.inputTokens, outputTokens: meta?.outputTokens,
      interrupted: meta?.interrupted,
    });

    return msg;
  }

  // ─── artifacts ────────────────────────────────────────────────────────────

  upsertArtifact(branchId: string, artifactPath: string, content: string,
                 baseContent: string | null = null,
                 mergeIntent: Artifact['mergeIntent'] = 'merge'): Artifact {
    const b = this.getBranch(branchId);
    if (!b) throw new Error(`Branch ${branchId} not found`);

    const id = Storage.hash(`${artifactPath}|${content}`);
    const ts = Date.now();

    // Step 1: remove any prior version of this path from the branch list.
    const prev = b.artifactIds
      .map(aid => this.storage.loadArtifact(aid))
      .find(a => a && a.path === artifactPath);
    if (prev && prev.id !== id) {
      b.artifactIds = b.artifactIds.filter(aid => aid !== prev.id);
    }

    // Step 2: ensure storage has the artifact (dedup-safe).
    let art = this.storage.loadArtifact(id);
    if (!art) {
      art = {
        id, path: artifactPath, content, baseContent, mergeIntent,
        createdAt: ts, updatedAt: ts,
      };
      this.storage.saveArtifact(art);
    }

    // Step 3: ensure branch references it.
    if (!b.artifactIds.includes(id)) {
      b.artifactIds.push(id);
    }
    this.saveBranch(b);

    this.storage.appendTelemetry({
      type: 'artifact_upserted', branchId, path: artifactPath, artifactId: id,
    });

    return art;
  }

  // ─── checkpoints ──────────────────────────────────────────────────────────

  createCheckpoint(branchId: string, label?: string): Checkpoint {
    const b = this.getBranch(branchId);
    if (!b) throw new Error(`Branch ${branchId} not found`);

    const parentCheckpointId = b.activeCheckpointId ?? b.parentCheckpointId;
    const stateString = JSON.stringify({
      branch: b.id,
      parentCheckpointId,
      msgs: b.messageIds,
      arts: b.artifactIds,
      label: label ?? null,
    });
    const id = Storage.hash(stateString);
    const existing = this.storage.loadCheckpoint(id);
    if (existing) {
      b.activeCheckpointId = existing.id;
      this.saveBranch(b);
      this.storage.appendTelemetry({
        type: 'checkpoint_created',
        branchId,
        checkpointId: existing.id,
        parentCheckpointId,
        label,
        deduped: true,
      });
      return existing;
    }

    const cp: Checkpoint = {
      id,
      branchId,
      parentCheckpointId,
      messageIds: [...b.messageIds],
      artifactIds: [...b.artifactIds],
      createdAt: Date.now(),
      label,
    };
    this.storage.saveCheckpoint(cp);
    b.activeCheckpointId = cp.id;
    this.saveBranch(b);

    this.storage.appendTelemetry({
      type: 'checkpoint_created',
      branchId,
      checkpointId: cp.id,
      parentCheckpointId,
      label,
      deduped: false,
    });

    return cp;
  }

  // ─── branching ────────────────────────────────────────────────────────────

  /**
   * Create a new branch.
   *
   * If `fromMessageId` is provided, the new branch's history is the parent
   * branch's messages up to and including that message.
   * If omitted, fork from the parent branch's current tip.
   */
  createBranch(opts: {
    name: string;
    description?: string;
    parentBranchId?: string;     // defaults to active branch
    fromMessageId?: string;      // defaults to tip
    tags?: string[];
  }): Branch {
    const parentId = opts.parentBranchId ?? this.activeBranchId;
    const parent = this.getBranch(parentId);
    if (!parent) throw new Error(`Parent branch ${parentId} not found`);

    // Determine the message slice for the new branch's starting history.
    let inheritedMessageIds: string[];
    let inheritedArtifactIds: string[];
    if (opts.fromMessageId) {
      const idx = parent.messageIds.indexOf(opts.fromMessageId);
      if (idx === -1) {
        throw new Error(`Message ${opts.fromMessageId} not in branch ${parentId}`);
      }
      inheritedMessageIds = parent.messageIds.slice(0, idx + 1);
      // Artifacts: include all artifacts from parent that existed by the time
      // of fromMessageId. Conservatively include all current artifacts; the
      // merge logic resolves baseContent properly anyway.
      inheritedArtifactIds = [...parent.artifactIds];
    } else {
      inheritedMessageIds = [...parent.messageIds];
      inheritedArtifactIds = [...parent.artifactIds];
    }

    // Create a checkpoint at the fork point on the parent.
    const checkpoint = this.createCheckpoint(parentId, `Fork point: ${opts.name}`);

    const id = `b_${Storage.hash(`${opts.name}|${Date.now()}|${parentId}`)}`;
    const branch: Branch = {
      id,
      name: this.uniqueName(opts.name),
      description: opts.description,
      parentBranchId: parentId,
      parentCheckpointId: checkpoint.id,
      activeCheckpointId: checkpoint.id,
      forkedAtMessageCount: inheritedMessageIds.length,
      messageIds: inheritedMessageIds,
      artifactIds: inheritedArtifactIds,
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: opts.tags,
    };
    this.storage.saveBranch(branch);
    this.branchCache.set(id, branch);

    this.state.branchIds.push(id);
    this.save();

    this.storage.appendTelemetry({
      type: 'branch_created',
      branchId: id, name: branch.name, parentBranchId: parentId,
      fromMessageId: opts.fromMessageId, checkpointId: checkpoint.id,
    });

    return branch;
  }

  private uniqueName(desired: string): string {
    const existing = new Set(this.getAllBranches().map(b => b.name));
    if (!existing.has(desired)) return desired;
    let i = 2;
    while (existing.has(`${desired}-${i}`)) i++;
    return `${desired}-${i}`;
  }

  restoreCheckpoint(branchId: string, checkpointId: string): Checkpoint {
    const b = this.getBranch(branchId);
    if (!b) throw new Error(`Branch ${branchId} not found`);

    const cp = this.storage.loadCheckpoint(checkpointId);
    if (!cp) throw new Error(`Checkpoint ${checkpointId} not found`);
    if (cp.branchId !== branchId) {
      throw new Error(`Checkpoint ${checkpointId} does not belong to branch ${branchId}`);
    }

    b.messageIds = [...cp.messageIds];
    b.artifactIds = [...cp.artifactIds];
    b.activeCheckpointId = cp.id;
    if (b.status === 'draft') b.status = 'active';
    this.saveBranch(b);

    this.storage.appendTelemetry({
      type: 'checkpoint_restored',
      branchId,
      checkpointId: cp.id,
    });

    return cp;
  }

  // ─── switching ────────────────────────────────────────────────────────────

  switchBranch(branchId: string): void {
    const b = this.getBranch(branchId);
    if (!b) throw new Error(`Branch ${branchId} not found`);
    if (this.state.activeBranchId === branchId) return;

    this.storage.appendTelemetry({
      type: 'branch_switched',
      from: this.state.activeBranchId, to: branchId,
    });

    this.state.activeBranchId = branchId;
    this.save();
  }

  // ─── status ───────────────────────────────────────────────────────────────

  setBranchStatus(branchId: string, status: BranchStatus): void {
    const b = this.getBranch(branchId);
    if (!b) throw new Error(`Branch ${branchId} not found`);
    b.status = status;
    this.saveBranch(b);
    this.storage.appendTelemetry({ type: 'branch_status_changed', branchId, status });
  }

  // ─── deletion / abandon ───────────────────────────────────────────────────

  abandonBranch(branchId: string): void {
    if (branchId === this.mainBranchId) throw new Error('Cannot abandon main');
    this.setBranchStatus(branchId, 'abandoned');
  }

  getCheckpointsForBranch(branchId: string): Checkpoint[] {
    return this.getAllCheckpoints()
      .filter(cp => cp.branchId === branchId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  getHistoryGraph(): {
    branches: Branch[];
    checkpoints: Checkpoint[];
    checkpointsByBranch: Record<string, Checkpoint[]>;
    mergeEvents: MergeEvent[];
  } {
    const branches = this.getAllBranches()
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);

    // Load every checkpoint (fork, pre-merge, manual — all of them).
    const checkpoints = this.getAllCheckpoints()
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt);

    // Bucket checkpoints by branch — saves the renderer from doing
    // its own grouping pass. Each bucket is already chronologically sorted
    // because we sorted the full list first.
    const checkpointsByBranch: Record<string, Checkpoint[]> = {};
    for (const b of branches) checkpointsByBranch[b.id] = [];
    for (const cp of checkpoints) {
      if (!checkpointsByBranch[cp.branchId]) {
        // Branch might have been abandoned and removed from the active list
        // but its checkpoints can still live on disk. Skip them or include
        // them under a sentinel key — depends on what you want to render.
        continue;
      }
      checkpointsByBranch[cp.branchId].push(cp);
    }

    const mergeEvents = this.storage.loadAllMergeEvents();

    return { branches, checkpoints, checkpointsByBranch, mergeEvents };
  }
}
