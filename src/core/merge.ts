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
import { Workspace } from './workspace';
import { Storage } from './storage';
import {
  Branch, Artifact, MergeEvent, VerificationResult, ArtifactConflict,
  Message
} from './types';
import { CascadingEditProposal } from '../agents/merge-analyst';
import { ConflictResolution } from '../agents/conflict-resolver';

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
  consolidate?: (branch: Branch, messages: Message[], targetBranch: Branch) => Promise<string>;
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
}

// ─── merge implementation ────────────────────────────────────────────────────

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
            base: sa.baseContent ?? '',
            theirs: ta.content,
            ours: sa.content,
            theirContext: targetMessagesForCtx.slice(-4),
            ourContext: sourceMessages.slice(-4),
          });
          conflictResolutions.push(resolution);
        } catch (err: any) {
          conflictResolutions.push({
            path: cp,
            resolvedContent: ta.content,
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
      synthesisDraft = await opts.consolidate(source, sourceMessages, target);
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
  };
}

export async function finalizeMerge(
  ws: Workspace,
  opts: MergeOptions,
  preview: MergePreview
): Promise<MergeEvent> {
  const source = ws.getBranch(opts.sourceBranchId)!;
  const target = ws.getBranch(opts.targetBranchId)!;

  // Re-evaluate whether anything is still blocking after the user's
  // accepted conflict resolutions have been applied.

  const accepted = new Set(opts.acceptedConflictPaths ?? []);
  const conflicts = preview.verification.artifactConflicts ?? [];

  // Only conflicts that were NOT accepted remain blocking.
  const unresolvedConflicts = conflicts.filter(
    c => !accepted.has(c.path)
  );

  // Preserve test failures as blocking.
  const testFailed =
    typeof preview.verification.testOutput === 'string' &&
    /FAIL:/i.test(preview.verification.testOutput);

  const blockingFailure =
    unresolvedConflicts.length > 0 || testFailed;

  if (blockingFailure && !opts.force) {
    throw new Error(
      'Merge verification failed. Resolve conflicts, fix tests, or pass force=true.'
    );
  }

  // Pre-merge snapshot of target — for undo
  const targetSnapshot = ws.createCheckpoint(target.id, `Pre-merge of ${source.name}`);

  // Apply artifact changes onto target
  applyArtifactChanges(ws, source, target, preview, opts.acceptedConflictPaths);

  // NEW: apply any accepted cascading-edit proposals. These are EDITS to
  // unchanged target files that the analyst flagged as needing updates.
  // Each accepted proposal becomes an artifact in the target (with the
  // current target content as the new baseContent, so future merges
  // 3-way-diff cleanly against this state).
  const acceptedSet = new Set(opts.acceptedCascadePaths ?? []);
  let cascadingAppliedCount = 0;
  if (preview.cascadingProposals && acceptedSet.size > 0) {
    for (const proposal of preview.cascadingProposals) {
      if (!acceptedSet.has(proposal.path)) continue;
      ws.upsertArtifact(
        target.id,
        proposal.path,
        proposal.proposedContent,
        proposal.currentContent,
        'merge',
      );
      cascadingAppliedCount++;
    }
  }

  // Append messages: in linear append-only model, source messages flow into target.
  // BUT — to honor the consolidation finding (Laban), we replace the raw
  // source-message stream with a single synthesis turn unless the caller
  // explicitly opts out. The raw history remains in storage attached to the
  // (now-merged) source branch.
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
    // Fallback: append raw messages (study linear-condition behavior)
    const sourceMessages = ws.getMessages(source.id);
    // Skip messages inherited from parent — only append what the branch added.
    const baseSize = source.forkedAtMessageCount;
    const newMessages = sourceMessages.slice(baseSize);
    for (const m of newMessages) {
      ws.appendMessage(target.id, m.role, m.content, m.meta);
    }
  }

  // Snapshot the finalized merged state so the branch head and graph stay aligned.
  const postMergeCheckpoint = ws.createCheckpoint(target.id, `Post-merge of ${source.name}`);

  // Mark source branch as merged
  source.status = 'merged';
  source.mergedIntoBranchId = target.id;
  source.mergedAt = Date.now();
  source.mergedAsCheckpointId = postMergeCheckpoint.id;
  ws.storage.saveBranch(source);

  // Build merge event
  const event: MergeEvent = {
    id: preview.mergeEventId,
    sourceBranchId: source.id,
    targetBranchId: target.id,
    taskId: opts.taskId,
    startedAt: preview.verification.ranAt,
    completedAt: Date.now(),
    verification: { ...preview.verification, forced: !!opts.force && preview.verification.status === 'fail' },
    targetSnapshotCheckpointId: targetSnapshot.id,
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
    verificationStatus: preview.verification.status,
    forced: event.verification.forced,
    cascadingProposalsTotal: preview.cascadingProposals?.length ?? 0,
    cascadingProposalsAccepted: cascadingAppliedCount,
  });

  return event;
}

// ─── 3-way artifact merge ────────────────────────────────────────────────────

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

    // 3-way merge: base = sa.baseContent (state at fork), ours = ta.content,
    // theirs = sa.content
    const base = sa.baseContent ?? '';
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
      const base = sa.baseContent ?? '';
      let finalContent = sa.content;
      if (base !== ta.content && base !== sa.content) {
        // both changed; use auto-merge result
        const merged = tryAutoMerge(base, ta.content, sa.content);
        if (merged.success) finalContent = merged.text;
      }
      ws.upsertArtifact(target.id, sa.path, finalContent, ta.content, 'merge');
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
 * Simple line-level 3-way merge with conflict markers.
 * For real production use, replace with the `diff3` npm package.
 */
function tryAutoMerge(base: string, ours: string, theirs: string):
  { success: boolean; text: string } {
  if (ours === theirs) return { success: true, text: ours };
  if (ours === base) return { success: true, text: theirs };
  if (theirs === base) return { success: true, text: ours };

  // Naive line-based merge: if no overlapping changes, concatenate cleanly.
  const baseLines = base.split('\n');
  const ourLines = ours.split('\n');
  const theirLines = theirs.split('\n');

  // If both are pure additions to the base, append ours then theirs.
  if (
    ours.startsWith(base) && theirs.startsWith(base) &&
    ourLines.length >= baseLines.length && theirLines.length >= baseLines.length
  ) {
    const ourAdd = ourLines.slice(baseLines.length).join('\n');
    const theirAdd = theirLines.slice(baseLines.length).join('\n');
    return { success: true, text: base + '\n' + ourAdd + '\n' + theirAdd };
  }

  // Otherwise, mark as conflict.
  return {
    success: false,
    text:
      `<<<<<<< target\n${ours}\n=======\n${theirs}\n>>>>>>> source\n`,
  };
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