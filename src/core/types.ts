/**
 * ContextBranch core data model.
 *
 * Design principles:
 * - All persistent objects are content-addressable (SHA-256 hash) where possible.
 * - Branches are independent. Switching branches never mutates other branches.
 * - Main is append-only. Merges always tack onto current main; the AI's
 *   "recommended order" is advisory, not enforced. Lazy rebase resolves real
 *   dependencies at merge time.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Messages
// ──────────────────────────────────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant';

export interface Message {
  id: string;            // SHA-256 of (role + content + timestamp)
  role: Role;
  content: string;
  timestamp: number;
  /** Token counts and model used; for telemetry / study analysis. */
  meta?: {
    inputTokens?: number;
    outputTokens?: number;
    model?: string;
    interrupted?: boolean;
    /** If this assistant message proposed artifact changes, the artifact IDs. */
    artifactIds?: string[];
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Artifacts
//
// An artifact is a file the AI created or modified during a branch.
// Each artifact knows its base content (file content as of the branch point)
// for proper 3-way merging.
// ──────────────────────────────────────────────────────────────────────────────

export interface Artifact {
  id: string;            // SHA-256 of (path + content)
  path: string;          // workspace-relative path
  content: string;
  baseContent: string | null;  // content at branch point (null = newly created)
  /** What should happen to this artifact at branch merge? */
  mergeIntent: 'merge' | 'discard' | 'ask';
  createdAt: number;
  updatedAt: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Checkpoints
//
// Immutable snapshot of a branch's state at a point in time. Used as the
// branching anchor (parent for new branches) and as the rebase base.
// ──────────────────────────────────────────────────────────────────────────────

export interface Checkpoint {
  id: string;            // SHA-256 of state
  branchId: string;      // branch this checkpoint was taken from
  parentCheckpointId: string | null; // previous checkpoint in the chain
  messageIds: string[];  // ordered list of message IDs at checkpoint time
  artifactIds: string[]; // ordered list of artifact IDs at checkpoint time
  createdAt: number;
  label?: string;        // optional human label
}

// ──────────────────────────────────────────────────────────────────────────────
// Branches
//
// A branch is a divergent line of conversation + artifacts.
// 'main' is special only in being the default merge target.
// ──────────────────────────────────────────────────────────────────────────────

export type BranchStatus =
  | 'draft'      // freshly created, no messages yet
  | 'active'     // user is working on it
  | 'ready'      // user marked ready for merge
  | 'merging'    // currently being merged
  | 'merged'     // already merged into target (read-only)
  | 'abandoned'; // user explicitly abandoned

export interface Branch {
  id: string;
  name: string;
  description?: string;
  parentBranchId: string | null;     // 'main' has null
  parentCheckpointId: string | null; // checkpoint this branch forked from
  activeCheckpointId: string | null; // checkpoint representing the branch head
  /** Count of messages inherited from parent at branch creation. */
  forkedAtMessageCount: number;
  messageIds: string[];              // ordered list of message IDs in this branch
  artifactIds: string[];             // ordered list of artifact versions in this branch
  status: BranchStatus;
  createdAt: number;
  updatedAt: number;
  mergedIntoBranchId?: string;
  mergedAt?: number;
  mergedAsCheckpointId?: string;     // the checkpoint created when merged
  /** Tags for clustering / filtering in the UI. */
  tags?: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Merge plan
//
// A Task owns a set of branches and an explicit merge plan.
// Merge plan is a partial order: each entry can declare "must follow" predecessors.
// The system displays a topologically-sorted total order as the recommended
// merge sequence; user can override.
// ──────────────────────────────────────────────────────────────────────────────

export interface MergePlanEntry {
  branchId: string;
  /** Branch IDs that must be merged before this one. */
  predecessors: string[];
  /** User-set or AI-set priority within the topological order. */
  priority: number;
  /** Has this entry been merged yet? */
  merged: boolean;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  rootBranchId: string;          // typically 'main'
  branchIds: string[];           // branches belonging to this task
  mergePlan: MergePlanEntry[];
  createdAt: number;
  status: 'planning' | 'executing' | 'completed';
}

// ──────────────────────────────────────────────────────────────────────────────
// Merge verification
//
// A merge is only finalized after verification passes (or user force-merges).
// ──────────────────────────────────────────────────────────────────────────────

export type VerificationStatus = 'pass' | 'fail' | 'skipped' | 'pending';

export interface VerificationResult {
  status: VerificationStatus;
  ranAt: number;
  testOutput?: string;
  lintOutput?: string;
  consistencyWarnings?: string[];
  artifactConflicts?: ArtifactConflict[];
  /** True if user chose to force-merge despite failures. */
  forced: boolean;
}

export interface ArtifactConflict {
  path: string;
  /** Format: unified diff with conflict markers. */
  conflictRegion: string;
  baseContent: string;
  branchAContent: string;
  branchBContent: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Merge events (for telemetry / undo / audit trail)
// ──────────────────────────────────────────────────────────────────────────────

export interface MergeEvent {
  id: string;
  sourceBranchId: string;
  targetBranchId: string;
  taskId?: string;
  startedAt: number;
  completedAt?: number;
  verification: VerificationResult;
  /** Pre-merge snapshot of target — for undo. */
  targetSnapshotCheckpointId: string;
  /** AI-generated synthesis turn that summarizes what was merged. */
  synthesisMessageId?: string;
  /** Lazy-rebase log: did the source branch need adjustment for current target? */
  rebaseNotes?: string[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Workspace
//
// The top-level container. Persists to .contextbranch/ in the workspace.
// ──────────────────────────────────────────────────────────────────────────────

export interface WorkspaceState {
  version: 1;
  createdAt: number;
  activeBranchId: string;        // currently focused
  mainBranchId: string;          // root (usually 'main')
  branchIds: string[];
  taskIds: string[];
  mergeEventIds: string[];
  /** Per-conversation telemetry; see telemetry.ts. */
  telemetry: {
    sessionStartedAt: number;
    totalApiCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    /** Calls the merge engine makes on its own (analyst + conflict resolver). */
    totalMergeApiCalls: number;
    totalMergeInputTokens: number;
    totalMergeOutputTokens: number;
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Study export schema (for the user study)
// ──────────────────────────────────────────────────────────────────────────────

export interface StudyExport {
  participantId: string;
  condition: 'linear' | 'branched' | 'contextbranch';
  exportedAt: number;
  sessionDurationMs: number;
  branches: Branch[];
  mergeEvents: MergeEvent[];
  // Counts
  branchCount: number;
  mergeCount: number;
  forcedMergeCount: number;
  abandonedBranchCount: number;
}
