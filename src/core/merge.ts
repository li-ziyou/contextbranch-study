/**
 * Merge logic.
 *
 * Pipeline:
 *   1. Snapshot target (for undo)
 *   2. Lazy rebase: detect if target has changed since source's checkpoint
 *      and ask AI to flag any conflicts in source's reasoning given new target
 *   3. Compute artifact diff (3-way merge for each touched file)
 *   4. Run verification (test cmd + lint cmd + AI consistency check)
 *   5. If green OR forced → consolidate source's conversation, append to target
 *   6. Record MergeEvent
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Workspace } from './workspace';
import { Storage } from './storage';
import {
  Branch, Artifact, MergeEvent, VerificationResult, ArtifactConflict,
  Message
} from './types';
import { CascadingEditProposal } from '../agents/merge-analyst';
import { ConflictResolution } from '../agents/conflict-resolver';
import { merge3, looksElided } from './edits';

const execAsync = promisify(exec);

// ─── public API ──────────────────────────────────────────────────────────────

export interface MergeOptions {
  sourceBranchId: string;
  targetBranchId: string;
  /** Generate a synthesis turn for the merge. */
  generateSynthesis?: boolean;
  /** If verification fails, force-merge anyway (recorded as forced). */
  force?: boolean;
  /** Skip running verification — used in linear-condition study mode. */
  skipVerification?: boolean;
  /** Optional task ID this merge belongs to. */
  taskId?: string;
  /** Workspace root for running test/lint commands. */
  workspaceRoot?: string;
  /** Test command override. */
  testCommand?: string;
  /** Lint command override. */
  lintCommand?: string;
  /**
   * Hook to ask the LLM to consolidate the branch into a synthesis turn.
   * Provided by the caller (extension wires up the agent).
   */
  consolidate?: (branch: Branch, messages: Message[],
                 changedFiles: { path: string; status: string; before: string; after: string }[],
                 targetBranch: Branch) => Promise<string>;
  /** Hook for AI-based rebase consistency check. */
  rebaseCheck?: (source: Branch, target: Branch,
                 sourceMessages: Message[], targetMessages: Message[]) => Promise<string[]>;
  /** Hook for AI consistency check on the merge result. */
  consistencyCheck?: (target: Branch, mergedMessages: Message[]) => Promise<string[]>;
  /**
   * NEW: hook for cascading-edit analysis. Given the source and target
   * branches and the textual diff, returns proposed edits to OTHER files
   * in target that should change to remain consistent. The user opts in
   * to each proposal via `acceptedCascadePaths` below.
   */
  analyzeCascade?: (
    source: Branch,
    target: Branch,
    sourceArtifacts: Artifact[],
    targetArtifacts: Artifact[],
    changedFiles: { path: string; before: string; after: string; status: 'add' | 'modify' | 'conflict' }[],
    recentMessages: Message[],
  ) => Promise<{ summary: string; proposals: CascadingEditProposal[]; error?: string }>;
  /**
   * NEW: paths of cascading proposals the user accepted in the preview UI.
   * Only used in finalizeMerge. Passing a path the analyst didn't propose
   * is a no-op (we look proposals up on `preview`).
   */
  acceptedCascadePaths?: string[];
  /**
   * NEW: hook for AI-mediated conflict resolution. Called once per
   * conflicting artifact path. Returns a proposed unified resolution
   * with a confidence level. Failures are non-fatal — the merge falls
   * back to the textual conflict-marker merge for that path.
   */
  resolveConflict?: (opts: {
    path: string;
    base: string;
    theirs: string;
    ours: string;
    theirContext: Message[];
    ourContext: Message[];
  }) => Promise<ConflictResolution>;
  /**
   * NEW: paths of conflict resolutions the user accepted. For conflicting
   * paths whose resolution is NOT in this set, the markered (Git-style)
   * version is written instead.
   */
  acceptedConflictPaths?: string[];
}

export interface MergePreview {
  mergeEventId: string;
  verification: VerificationResult;
  artifactChanges: { path: string; status: 'add' | 'modify' | 'conflict' }[];
  rebaseNotes: string[];
  synthesisDraft?: string;
  /** NEW: AI-proposed cross-file edits the user can accept individually. */
  cascadingProposals?: CascadingEditProposal[];
  /** NEW: one-line summary from the analyst (or error if the call failed). */
  cascadingSummary?: string;
  /** NEW: AI-mediated resolution candidates for each conflict (user opts in). */
  conflictResolutions?: ConflictResolution[];
  /** Fingerprint of source/target state when this preview was generated. */
  stateFingerprint: string;
  /** Target branch state immediately before the preview was generated. */
  targetHeadFingerprint: string;
}

// ─── merge implementation ────────────────────────────────────────────────────

export function branchStateFingerprint(ws: Workspace, branchId: string): string {
  const b = ws.getBranch(branchId);
  if (!b) throw new Error(`Branch ${branchId} not found`);
  return Storage.hash(JSON.stringify({
    branchId: b.id,
    status: b.status,
    parentCheckpointId: b.parentCheckpointId,
    activeCheckpointId: b.activeCheckpointId,
    messageIds: b.messageIds,
    artifactIds: b.artifactIds,
  }));
}

function mergeStateFingerprint(ws: Workspace, sourceId: string, targetId: string): string {
  return Storage.hash(`${branchStateFingerprint(ws, sourceId)}|${branchStateFingerprint(ws, targetId)}`);
}

export async function previewMerge(
  ws: Workspace,
  opts: MergeOptions
): Promise<MergePreview> {
  const source = ws.getBranch(opts.sourceBranchId);
  const target = ws.getBranch(opts.targetBranchId);
  if (!source) throw new Error(`Source branch ${opts.sourceBranchId} not found`);
  if (!target) throw new Error(`Target branch ${opts.targetBranchId} not found`);
  if (source.status === 'merged') throw new Error('Source already merged');

  const sourceMessages = ws.getMessages(source.id);
  const targetMessages = ws.getMessages(target.id);

  // 1. Lazy rebase: has target moved since source's checkpoint?
  const rebaseNotes: string[] = [];
  if (source.parentCheckpointId) {
    const cp = ws.storage.loadCheckpoint(source.parentCheckpointId);
    if (cp) {
      const delta = target.messageIds.length - cp.messageIds.length;
      if (delta !== 0) {
        rebaseNotes.push(
          delta > 0
            ? `Target branch has ${delta} additional messages since this branch's fork point.`
            : `Target branch is ${Math.abs(delta)} messages behind this branch's fork point.`
        );
      }
      if (opts.rebaseCheck && delta !== 0) {
        try {
          const aiNotes = await opts.rebaseCheck(source, target, sourceMessages, targetMessages);
          rebaseNotes.push(...aiNotes);
        } catch (err: any) {
          rebaseNotes.push(`Rebase check skipped (error): ${err.message}`);
        }
      }
    }
  }

  // 2. Artifact diff
  const { changes, conflicts } = computeArtifactDiff(ws, source, target);

  // 3. Verification
  let verification: VerificationResult;
  if (opts.skipVerification) {
    verification = {
      status: 'skipped', ranAt: Date.now(), forced: false,
      artifactConflicts: conflicts,
    };
  } else {
    verification = await runVerification({
      ws, source, target, mergedMessages: [...targetMessages, ...sourceMessages],
      conflicts,
      workspaceRoot: opts.workspaceRoot,
      testCommand: opts.testCommand,
      lintCommand: opts.lintCommand,
      consistencyCheck: opts.consistencyCheck,
    });
  }

  // 4. NEW: Cascading-edit analysis. The LLM looks at every artifact in both
  //    branches and proposes edits to UNCHANGED target files that may now
  //    need updates to remain consistent with what source changed.
  //    Failures are non-fatal — the merge still proceeds without proposals.
  let cascadingProposals: CascadingEditProposal[] | undefined;
  let cascadingSummary: string | undefined;
  if (opts.analyzeCascade) {
    try {
      const sourceArtifacts = ws.getArtifacts(source.id);
      const targetArtifacts = ws.getArtifacts(target.id);
      const targetByPath = new Map(targetArtifacts.map(a => [a.path, a]));
      const changedFiles = changes.map(c => {
        const ta = targetByPath.get(c.path);
        const sa = sourceArtifacts.find(a => a.path === c.path);
        return {
          path: c.path,
          before: ta?.content ?? '',
          after: sa?.content ?? '',
          status: c.status,
        };
      });
      // Pass a small slice of the most recent source messages so the analyst
      // has intent (the conversation that produced the change), not just diffs.
      const recentMessages = sourceMessages.slice(-4);
      const analystResult = await opts.analyzeCascade(
        source, target, sourceArtifacts, targetArtifacts, changedFiles, recentMessages,
      );
      cascadingProposals = analystResult.proposals;
      cascadingSummary = analystResult.error
        ? `Analyst error: ${analystResult.error}`
        : analystResult.summary;
    } catch (err: any) {
      cascadingSummary = `Cascade analysis failed: ${err.message ?? err}`;
    }
  }

  // 4b. NEW: Per-conflict AI resolution. For each artifact marked 'conflict',
  //     hand the LLM the base/theirs/ours plus recent messages from both
  //     branches and ask for a unified file. User accepts/rejects each
  //     resolution individually in the UI.
  let conflictResolutions: ConflictResolution[] | undefined;
  if (opts.resolveConflict) {
    const conflictPaths = changes.filter(c => c.status === 'conflict').map(c => c.path);
    if (conflictPaths.length > 0) {
      conflictResolutions = [];
      const targetMessagesForCtx = ws.getMessages(target.id);
      const sourceArtifacts = ws.getArtifacts(source.id);
      const targetArtifacts = ws.getArtifacts(target.id);
      for (const cp of conflictPaths) {
        const sa = sourceArtifacts.find(a => a.path === cp);
        const ta = targetArtifacts.find(a => a.path === cp);
        if (!sa || !ta) continue;
        try {
          const resolution = await opts.resolveConflict({
            path: cp,
            base: forkBaseContent(ws, source, cp) ?? sa.baseContent ?? '',
            theirs: ta.content,
            ours: sa.content,
            theirContext: targetMessagesForCtx.slice(-4),
            ourContext: sourceMessages.slice(-4),
          });
          conflictResolutions.push(resolution);
        } catch (err: any) {
          // Fall back to a marker merge (NOT target-only, which would drop the
          // source branch's work).
          const base = forkBaseContent(ws, source, cp) ?? sa.baseContent ?? '';
          const merged = merge3(base, ta.content, sa.content, { ours: 'target', theirs: 'source' });
          conflictResolutions.push({
            path: cp,
            resolvedContent: merged.text,
            rationale: '',
            confidence: 'low',
            originalContent: ta.content,
            error: err.message ?? String(err),
          });
        }
      }
    }
  }

  // 5. Synthesis (draft only — actual append happens on finalize)
  let synthesisDraft: string | undefined;
  if (opts.generateSynthesis && opts.consolidate) {
    try {
      // Build the ACTUAL diffs this branch introduces (target current vs source
      // current), so the summary reflects real files — not rejected proposals.
      const tgtArts = ws.getArtifacts(target.id);
      const tgtByPath = new Map(tgtArts.map(a => [a.path, a.content]));
      const resByPath = new Map((conflictResolutions ?? []).map(r => [r.path, r.resolvedContent]));
      const changedFiles = changes.map(c => ({
        path: c.path,
        status: c.status,
        before: tgtByPath.get(c.path) ?? '',
        // The ACTUAL merged result — NOT the source branch's raw file. Using raw
        // source made the summary claim a merge "removed" things that the merge
        // actually kept. For a resolved conflict, use the resolution.
        after: (c.status === 'conflict' && resByPath.has(c.path))
          ? resByPath.get(c.path)!
          : mergedContentFor(ws, source, target, c),
      }));
      synthesisDraft = await opts.consolidate(source, sourceMessages, changedFiles, target);
    } catch (err: any) {
      synthesisDraft = `(Synthesis unavailable: ${err.message})`;
    }
  }

  const mergeEventId = `me_${Storage.hash(`${source.id}->${target.id}|${Date.now()}`)}`;

  return {
    mergeEventId,
    verification,
    artifactChanges: changes,
    rebaseNotes,
    synthesisDraft,
    cascadingProposals,
    cascadingSummary,
    conflictResolutions,
    stateFingerprint: mergeStateFingerprint(ws, source.id, target.id),
    targetHeadFingerprint: branchStateFingerprint(ws, target.id),
  };
}

export async function finalizeMerge(
  ws: Workspace,
  opts: MergeOptions,
  preview: MergePreview
): Promise<MergeEvent> {
  const source = ws.getBranch(opts.sourceBranchId);
  const target = ws.getBranch(opts.targetBranchId);
  if (!source || !target) throw new Error('Merge branch no longer exists');
  if (source.status === 'merged') throw new Error('Source already merged');

  // The user reviewed this exact preview. If either branch moved afterwards,
  // never silently recompute a different preview and merge that instead.
  const nowFingerprint = mergeStateFingerprint(ws, source.id, target.id);
  if (nowFingerprint !== preview.stateFingerprint) {
    throw new Error('Merge preview is stale because the source or target branch changed after preview. Preview the merge again before finalizing.');
  }

  const acceptedConflicts = new Set(opts.acceptedConflictPaths ?? []);
  const acceptedCascades = new Set(opts.acceptedCascadePaths ?? []);
  const conflicts = preview.verification.artifactConflicts ?? [];
  const unresolved = conflicts.filter(c => !acceptedConflicts.has(c.path));
  if (unresolved.length > 0) {
    // Force is intentionally NOT allowed to bypass unresolved file conflicts.
    throw new Error(`Merge blocked: ${unresolved.length} unresolved file conflict${unresolved.length === 1 ? '' : 's'} remain. Resolve or explicitly reject them before merging.`);
  }

  const resolutionByPath = new Map((preview.conflictResolutions ?? []).map(r => [r.path, r]));
  for (const p of acceptedConflicts) {
    const resolution = resolutionByPath.get(p);
    if (!resolution || resolution.path !== p || /<{5,}|>{5,}/.test(resolution.resolvedContent) || looksElided(resolution.resolvedContent, resolution.originalContent)) {
      throw new Error(`Merge blocked: accepted conflict resolution for ${p} is missing or unsafe.`);
    }
  }

  const cascadeByPath = new Map((preview.cascadingProposals ?? []).map(p => [p.path, p]));
  for (const p of acceptedCascades) {
    const proposal = cascadeByPath.get(p);
    if (!proposal) throw new Error(`Merge blocked: cascade proposal for ${p} is not part of the reviewed preview.`);
    const currentTarget = ws.getArtifacts(target.id).find(a => a.path === p)?.content ?? '';
    if (currentTarget !== proposal.currentContent) {
      throw new Error(`Merge blocked: cascade proposal for ${p} is stale because that target file changed after preview.`);
    }
    if (/<{5,}|>{5,}/.test(proposal.proposedContent) || /\.\.\.\s*(rest|existing|unchanged)/i.test(proposal.proposedContent)) {
      throw new Error(`Merge blocked: cascade proposal for ${p} contains unsafe placeholder/conflict content.`);
    }
  }

  const candidate = buildCandidateFiles(ws, source, target, preview, acceptedConflicts, acceptedCascades);

  // Verify the ACTUAL candidate that is about to be committed, not the current
  // workspace before applying it. This catches test failures introduced by the
  // merge, including accepted conflict/cascade resolutions.
  let candidateVerification: VerificationResult = {
    status: 'skipped', ranAt: Date.now(), forced: false,
    artifactConflicts: [],
  };
  if (!opts.skipVerification) {
    candidateVerification = await runCandidateVerification({
      workspaceRoot: opts.workspaceRoot,
      testCommand: opts.testCommand,
      lintCommand: opts.lintCommand,
      candidate,
    });
    if (candidateVerification.status === 'fail' && !opts.force) {
      throw new Error('Merge blocked: tests failed against the exact candidate merge. Fix the candidate or explicitly force a test failure (file conflicts can never be forced).');
    }
  }

  // Snapshot target immediately before the actual mutation. This checkpoint is
  // the exact state undoMerge will restore; it is never deleted by undo.
  const targetSnapshot = ws.createCheckpoint(target.id, `Pre-merge of ${source.name}`);

  applyArtifactChanges(ws, source, target, preview, opts.acceptedConflictPaths);

  let cascadingAppliedCount = 0;
  for (const p of acceptedCascades) {
    const proposal = cascadeByPath.get(p)!;
    ws.upsertArtifact(target.id, proposal.path, proposal.proposedContent, proposal.currentContent, 'merge');
    cascadingAppliedCount++;
  }

  let synthesisMessageId: string | undefined;
  if (preview.synthesisDraft) {
    const synth = ws.appendMessage(
      target.id,
      'system',
      `[merge] ${source.name} → ${target.name}\n\n${preview.synthesisDraft}`,
      { model: 'merge-synthesis' }
    );
    synthesisMessageId = synth.id;
  } else {
    const sourceMessages = ws.getMessages(source.id);
    const baseSize = source.forkedAtMessageCount;
    const newMessages = sourceMessages.slice(baseSize);
    for (const m of newMessages) ws.appendMessage(target.id, m.role, m.content, m.meta);
  }

  const postMergeCheckpoint = ws.createCheckpoint(target.id, `Post-merge of ${source.name}`);
  const previousSourceStatus = source.status;
  source.status = 'merged';
  source.mergedIntoBranchId = target.id;
  source.mergedAt = Date.now();
  source.mergedAsCheckpointId = postMergeCheckpoint.id;
  ws.storage.saveBranch(source);

  const verification = {
    ...candidateVerification,
    // Preserve the preview's rebase/conflict metadata for history.
    artifactConflicts: preview.verification.artifactConflicts,
    forced: !!opts.force && candidateVerification.status === 'fail',
  };
  const event: MergeEvent = {
    id: preview.mergeEventId,
    sourceBranchId: source.id,
    targetBranchId: target.id,
    taskId: opts.taskId,
    startedAt: preview.verification.ranAt,
    completedAt: Date.now(),
    verification,
    targetSnapshotCheckpointId: targetSnapshot.id,
    postMergeCheckpointId: postMergeCheckpoint.id,
    sourcePreviousStatus: previousSourceStatus,
    synthesisMessageId,
    rebaseNotes: preview.rebaseNotes,
  };
  ws.storage.saveMergeEvent(event);
  ws.workspaceState.mergeEventIds.push(event.id);
  ws.storage.saveWorkspace(ws.workspaceState);

  ws.storage.appendTelemetry({
    type: 'merge_finalized',
    eventId: event.id,
    sourceBranchId: source.id, targetBranchId: target.id,
    verificationStatus: verification.status,
    forced: event.verification.forced,
    cascadingProposalsTotal: preview.cascadingProposals?.length ?? 0,
    cascadingProposalsAccepted: cascadingAppliedCount,
  });

  return event;
}

function buildCandidateFiles(
  ws: Workspace,
  source: Branch,
  target: Branch,
  preview: MergePreview,
  acceptedConflicts: Set<string>,
  acceptedCascades: Set<string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of ws.getArtifacts(target.id)) out.set(a.path, a.content);
  const resolutionByPath = new Map((preview.conflictResolutions ?? []).map(r => [r.path, r]));
  for (const change of preview.artifactChanges) {
    const sa = ws.getArtifacts(source.id).find(a => a.path === change.path);
    if (!sa || sa.mergeIntent === 'discard') continue;
    const ta = ws.getArtifacts(target.id).find(a => a.path === change.path);
    if (change.status === 'add' || !ta) out.set(change.path, sa.content);
    else if (change.status === 'modify') out.set(change.path, mergedContentFor(ws, source, target, change));
    else if (acceptedConflicts.has(change.path)) out.set(change.path, resolutionByPath.get(change.path)!.resolvedContent);
  }
  for (const p of acceptedCascades) {
    const proposal = (preview.cascadingProposals ?? []).find(x => x.path === p);
    if (proposal) out.set(p, proposal.proposedContent);
  }
  return out;
}

interface CandidateVerificationInput {
  workspaceRoot?: string;
  testCommand?: string;
  lintCommand?: string;
  candidate: Map<string, string>;
}

async function runCandidateVerification(input: CandidateVerificationInput): Promise<VerificationResult> {
  const result: VerificationResult = { status: 'pass', ranAt: Date.now(), forced: false, artifactConflicts: [] };
  if (!input.workspaceRoot) { result.status = 'skipped'; return result; }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'contextbranch-merge-'));
  try {
    fs.cpSync(input.workspaceRoot, temp, {
      recursive: true,
      force: true,
      filter: (src) => {
        const rel = path.relative(input.workspaceRoot!, src);
        if (!rel) return true;
        const first = rel.split(path.sep)[0];
        return first !== '.git' && first !== '.contextbranch' && first !== '.study' && first !== 'node_modules';
      },
    });
    const nodeModules = path.join(input.workspaceRoot, 'node_modules');
    if (fs.existsSync(nodeModules)) {
      try { fs.symlinkSync(nodeModules, path.join(temp, 'node_modules'), 'junction'); } catch { /* optional */ }
    }
    for (const [rel, content] of input.candidate) {
      const full = path.join(temp, rel);
      const safe = path.relative(temp, full);
      if (safe.startsWith('..') || path.isAbsolute(safe)) throw new Error(`Unsafe candidate path: ${rel}`);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }

    const run = async (command: string, label: 'test' | 'lint') => {
      try {
        const { stdout, stderr } = await execAsync(command, { cwd: temp, timeout: 90_000, maxBuffer: 1_000_000 });
        const text = `${stdout}\n${stderr}`.trim();
        if (label === 'test') result.testOutput = text;
        else result.lintOutput = text;
      } catch (err: any) {
        const detail = `${err.message ?? ''}\n${err.stderr ?? ''}`;
        const missing = err.code === 127 || err.code === 'ENOENT' || /command not found|ENOENT|no such file/i.test(detail);
        const text = missing
          ? `SKIPPED: ${command} is not available in the candidate workspace.`
          : `FAIL: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`;
        if (label === 'test') {
          result.testOutput = text;
          if (!missing) result.status = 'fail';
        } else {
          result.lintOutput = text;
        }
      }
    };
    if (input.testCommand) await run(input.testCommand, 'test');
    if (input.lintCommand) await run(input.lintCommand, 'lint');
    if (!input.testCommand && !input.lintCommand) result.status = 'skipped';
  } catch (err: any) {
    result.status = 'fail';
    result.testOutput = `FAIL: candidate verification setup failed: ${err.message ?? String(err)}`;
  } finally {
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch {}
  }
  return result;
}

export async function undoMerge(ws: Workspace, mergeEventId: string): Promise<MergeEvent> {
  const event = ws.storage.loadMergeEvent(mergeEventId);
  if (!event) throw new Error(`Merge event ${mergeEventId} not found`);
  if (event.undoneAt) throw new Error('This merge has already been undone.');
  const target = ws.getBranch(event.targetBranchId);
  const source = ws.getBranch(event.sourceBranchId);
  if (!target || !source) throw new Error('Merge branches no longer exist.');
  if (!event.postMergeCheckpointId) throw new Error('This merge predates safe undo metadata and cannot be automatically undone.');

  const post = ws.storage.loadCheckpoint(event.postMergeCheckpointId);
  const pre = ws.storage.loadCheckpoint(event.targetSnapshotCheckpointId);
  if (!post || !pre) throw new Error('Merge checkpoints are missing; automatic undo is unsafe.');
  if (!branchMatchesCheckpoint(target, post)) {
    throw new Error('Cannot undo this merge safely: the target branch has changed since the merge. Create a checkpoint or revert those later changes first.');
  }

  ws.restoreCheckpoint(target.id, pre.id);
  const undoCheckpoint = ws.createCheckpoint(target.id, `Undo merge of ${source.name}`);
  source.status = event.sourcePreviousStatus ?? 'active';
  source.mergedIntoBranchId = undefined;
  source.mergedAt = undefined;
  source.mergedAsCheckpointId = undefined;
  ws.storage.saveBranch(source);

  event.undoneAt = Date.now();
  event.undoTargetCheckpointId = undoCheckpoint.id;
  event.undoSourceBranchStatus = source.status;
  ws.storage.saveMergeEvent(event);
  ws.storage.appendTelemetry({ type: 'merge_undone', eventId: event.id, sourceBranchId: source.id, targetBranchId: target.id });
  return event;
}

function branchMatchesCheckpoint(branch: Branch, cp: { messageIds: string[]; artifactIds: string[] }): boolean {
  return JSON.stringify(branch.messageIds) === JSON.stringify(cp.messageIds) &&
    JSON.stringify(branch.artifactIds) === JSON.stringify(cp.artifactIds);
}



// ─── 3-way artifact merge ────────────────────────────────────────────────────

/**
 * The content of `path` at the point `source` forked from its parent — read
 * from the immutable fork checkpoint. This is the correct common-ancestor for
 * a 3-way merge. Returns null if not recoverable (caller falls back).
 */
function forkBaseContent(ws: Workspace, source: Branch, path: string): string | null {
  if (!source.parentCheckpointId) return null;
  const cp = ws.storage.loadCheckpoint(source.parentCheckpointId);
  if (!cp) return null;
  for (const aid of cp.artifactIds) {
    const a = ws.storage.loadArtifact(aid);
    if (a && a.path === path) return a.content;
  }
  return null;
}

/**
 * The ACTUAL content a merge will write for one path — the single source of
 * truth used by BOTH the apply step and the summary, so they can never
 * disagree. Uses the immutable fork base (not the drifting sa.baseContent) and
 * never silently falls back to "source", which would drop target's work.
 */
function mergedContentFor(
  ws: Workspace, source: Branch, target: Branch,
  change: { path: string; status: 'add' | 'modify' | 'conflict' },
): string {
  const sa = ws.getArtifacts(source.id).find(a => a.path === change.path);
  const ta = ws.getArtifacts(target.id).find(a => a.path === change.path);
  if (!sa) return ta?.content ?? '';
  if (!ta || change.status === 'add') return sa.content;
  const base = forkBaseContent(ws, source, change.path) ?? sa.baseContent ?? '';
  if (base === ta.content) return sa.content;   // target untouched since fork → take source
  if (base === sa.content) return ta.content;   // source untouched → keep target
  return tryAutoMerge(base, ta.content, sa.content).text; // both changed → 3-way merge
}

function computeArtifactDiff(
  ws: Workspace,
  source: Branch,
  target: Branch
): { changes: { path: string; status: 'add' | 'modify' | 'conflict' }[];
     conflicts: ArtifactConflict[] } {
  const sourceArtifacts = ws.getArtifacts(source.id);
  const targetArtifacts = ws.getArtifacts(target.id);
  const targetByPath = new Map<string, Artifact>();
  for (const a of targetArtifacts) targetByPath.set(a.path, a);

  const changes: { path: string; status: 'add' | 'modify' | 'conflict' }[] = [];
  const conflicts: ArtifactConflict[] = [];

  for (const sa of sourceArtifacts) {
    if (sa.mergeIntent === 'discard') continue;
    const ta = targetByPath.get(sa.path);
    if (!ta) {
      // Newly added in source; no conflict.
      changes.push({ path: sa.path, status: 'add' });
      continue;
    }
    if (ta.content === sa.content) continue; // identical, nothing to do

    // 3-way merge: base = the file's content at the FORK POINT (immutable
    // checkpoint), ours = ta.content, theirs = sa.content. We read base from
    // the fork checkpoint rather than sa.baseContent because the latter drifts
    // (the watcher rewrites it to the previous version on every edit).
    const base = forkBaseContent(ws, source, sa.path) ?? sa.baseContent ?? '';
    if (base === ta.content) {
      // Target unchanged since fork; source is the only change.
      changes.push({ path: sa.path, status: 'modify' });
    } else if (base === sa.content) {
      // Source actually unchanged from base; target moved on; nothing to merge.
      continue;
    } else {
      // Both changed — try line-level merge
      const merged = tryAutoMerge(base, ta.content, sa.content);
      if (merged.success) {
        changes.push({ path: sa.path, status: 'modify' });
        // We'll actually apply the merge in applyArtifactChanges
      } else {
        changes.push({ path: sa.path, status: 'conflict' });
        conflicts.push({
          path: sa.path,
          conflictRegion: merged.text,
          baseContent: base,
          branchAContent: ta.content,
          branchBContent: sa.content,
        });
      }
    }
  }

  return { changes, conflicts };
}

function applyArtifactChanges(
  ws: Workspace,
  source: Branch,
  target: Branch,
  preview: MergePreview,
  acceptedConflictPaths?: string[],
): void {
  const sourceArtifacts = ws.getArtifacts(source.id);
  const targetArtifacts = ws.getArtifacts(target.id);
  const targetByPath = new Map<string, Artifact>();
  for (const a of targetArtifacts) targetByPath.set(a.path, a);

  const acceptedConflicts = new Set(acceptedConflictPaths ?? []);
  const resolutionByPath = new Map<string, ConflictResolution>();
  for (const r of preview.conflictResolutions ?? []) resolutionByPath.set(r.path, r);

  for (const change of preview.artifactChanges) {
    const sa = sourceArtifacts.find(a => a.path === change.path);
    if (!sa) continue;
    if (sa.mergeIntent === 'discard') continue;

    const ta = targetByPath.get(change.path);
    if (change.status === 'add' || !ta) {
      ws.upsertArtifact(target.id, sa.path, sa.content, sa.baseContent, 'merge');
    } else if (change.status === 'modify') {
      ws.upsertArtifact(target.id, sa.path,
        mergedContentFor(ws, source, target, change), ta.content, 'merge');
    } else {
      // conflict — if the user accepted the AI resolution for this path, use
      // that as the final content. Otherwise fall back to the markered
      // version (Git's behavior) so the developer can resolve manually.
      const resolution = resolutionByPath.get(sa.path);
      let finalContent: string;
      let mergeIntent: Artifact['mergeIntent'];
      if (resolution && acceptedConflicts.has(sa.path)) {
        finalContent = resolution.resolvedContent;
        mergeIntent = 'merge';
      } else {
        const merged = tryAutoMerge(sa.baseContent ?? '', ta.content, sa.content);
        finalContent = merged.text;
        mergeIntent = 'ask';
      }
      ws.upsertArtifact(target.id, sa.path, finalContent, ta.content, mergeIntent);
    }
  }
}

/**
 * Line-level 3-way merge. Delegates to the shared engine (edits.ts merge3),
 * which combines non-overlapping changes from both sides and emits localized
 * conflict markers only where they truly overlap.
 */
function tryAutoMerge(base: string, ours: string, theirs: string):
  { success: boolean; text: string } {
  const r = merge3(base, ours, theirs, { ours: 'target', theirs: 'source' });
  return { success: r.ok, text: r.text };
}

// ─── verification ────────────────────────────────────────────────────────────

interface VerificationInput {
  ws: Workspace;
  source: Branch;
  target: Branch;
  mergedMessages: Message[];
  conflicts: ArtifactConflict[];
  workspaceRoot?: string;
  testCommand?: string;
  lintCommand?: string;
  consistencyCheck?: (target: Branch, mergedMessages: Message[]) => Promise<string[]>;
}

async function runVerification(input: VerificationInput): Promise<VerificationResult> {
  const result: VerificationResult = {
    status: 'pending', ranAt: Date.now(), forced: false,
    artifactConflicts: input.conflicts,
  };

  // Hard fail on artifact conflicts
  if (input.conflicts.length > 0) {
    result.status = 'fail';
  }

  // Test command
  if (input.testCommand && input.workspaceRoot) {
    try {
      const { stdout, stderr } = await execAsync(input.testCommand, {
        cwd: input.workspaceRoot, timeout: 60_000,
      });
      result.testOutput = (stdout + '\n' + stderr).trim();
    } catch (err: any) {
      // Distinguish "the test runner isn't installed / couldn't start" from
      // "tests actually ran and failed". A missing binary (shell exit 127, or
      // ENOENT) is an environment gap, not a test failure, so it must NOT
      // block the merge.
      const detail = `${err.message ?? ''}\n${err.stderr ?? ''}`;
      const runnerMissing =
        err.code === 127 ||
        err.code === 'ENOENT' ||
        /command not found|not found|ENOENT|no such file/i.test(detail);
      if (runnerMissing) {
        result.testOutput =
          `SKIPPED: test command "${input.testCommand}" is not available on this machine; ` +
          `verification did not run tests.`;
        // leave result.status untouched — not a failure
      } else {
        result.testOutput = `FAIL: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`;
        result.status = 'fail';
      }
    }
  }

  // Lint command
  if (input.lintCommand && input.workspaceRoot) {
    try {
      const { stdout, stderr } = await execAsync(input.lintCommand, {
        cwd: input.workspaceRoot, timeout: 60_000,
      });
      result.lintOutput = (stdout + '\n' + stderr).trim();
    } catch (err: any) {
      result.lintOutput = `FAIL: ${err.message}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`;
      // Lint failures degrade to warnings, not hard fails — user choice.
    }
  }

  // AI consistency check
  if (input.consistencyCheck) {
    try {
      const warnings = await input.consistencyCheck(input.target, input.mergedMessages);
      result.consistencyWarnings = warnings;
    } catch (err: any) {
      result.consistencyWarnings = [`Consistency check failed: ${err.message}`];
    }
  }

  if (result.status === 'pending') result.status = 'pass';
  return result;
}

// ─── default test/lint detection ─────────────────────────────────────────────

export function detectTestCommand(workspaceRoot: string): string | null {
  if (!workspaceRoot) return null;
  if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test) return 'npm test';
    } catch { /* ignore */ }
  }
  if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(workspaceRoot, 'pytest.ini')) ||
      fs.existsSync(path.join(workspaceRoot, 'tests'))) {
    return 'pytest -q';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) return 'cargo test --quiet';
  return null;
}

export function detectLintCommand(workspaceRoot: string): string | null {
  if (!workspaceRoot) return null;
  if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
      if (pkg.scripts?.lint) return 'npm run lint';
    } catch { /* ignore */ }
  }
  if (fs.existsSync(path.join(workspaceRoot, '.eslintrc.json')) ||
      fs.existsSync(path.join(workspaceRoot, '.eslintrc.js'))) {
    return 'npx eslint .';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) {
    return 'ruff check . || flake8 .';
  }
  return null;
}
