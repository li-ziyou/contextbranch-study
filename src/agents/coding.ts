/**
 * Coding Agent: the per-branch chat assistant.
 *
 * Responsibilities:
 *  - Build the system prompt with branch context.
 *  - Stream the response.
 *  - Extract artifact code blocks (fenced + "# path:" / "// path:" header).
 */

import { LLMProvider, LLMMessage, LLMStreamEvent } from '../llm/provider';
import { codingAgentSystem } from '../llm/prompts';
import { Branch, Message, Artifact } from '../core/types';
import { WorkspaceFileCandidate } from './context';
import { isProtectedPath } from '../core/file-policy';

export interface ArtifactCandidate {
  path: string;
  content: string;
  language: string;
}

export class CodingAgent {
  constructor(private provider: LLMProvider) {}

  async *streamReply(opts: {
    branch: Branch;
    parentBranchName: string;
    isMain: boolean;
    history: Message[];
    workspaceRoot?: string;
    signal?: AbortSignal;
    model?: string;
    artifacts?: Artifact[];
    /** Actual workspace inventory, including files never touched by ContextBranch. */
    workspaceFiles?: WorkspaceFileCandidate[];
    /** Full contents selected by the Context Agent for this turn. */
    selectedFiles?: { path: string; content: string }[];
    contextRationale?: string;
    contextSummary?: string;
    /** One-shot corrective instruction for an automatically retried response. */
    repairInstruction?: string;
  }): AsyncIterable<LLMStreamEvent> {
    const baseSystem = codingAgentSystem({
      branchName: opts.branch.name,
      branchDescription: opts.branch.description,
      parentBranchName: opts.parentBranchName,
      isMain: opts.isMain,
      workspaceRoot: opts.workspaceRoot,
    });
    const system = baseSystem + buildArtifactContext(
      (opts.artifacts ?? []).filter(a => !isProtectedPath(a.path)),
      (opts.workspaceFiles ?? []).filter(f => !isProtectedPath(f.path)),
      (opts.selectedFiles ?? []).filter(f => !isProtectedPath(f.path)),
      opts.contextRationale,
      opts.contextSummary,
    );

    // The authoritative file state travels in the artifact context. Preserve
    // all useful turns, but bound their total size rather than their count.
    const messages = opts.repairInstruction
      ? buildEditRecoveryHistoryMessages(opts.history)
      : buildCodingHistoryMessages(opts.history);
    if (opts.repairInstruction) {
      messages.push({ role: 'user', content: opts.repairInstruction });
    }

    yield* this.provider.stream({
      system,
      messages,
      signal: opts.signal,
      model: opts.model,
      maxTokens: codingMaxOutputTokens(opts.model),
    });
  }
}

// ─── authoritative workspace context ───────────────────────────────────────
const MAX_MANIFEST_ENTRIES = 5_000;
const MAX_FULL_FILE_CHARS = 500_000;
const MAX_TOTAL_SELECTED_CHARS = 300_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
export const INTERRUPTED_ASSISTANT_CONTEXT =
  'The previous assistant response was interrupted. No edits from that response were applied.';
export const EDIT_PROPOSAL_CONTEXT =
  'The previous assistant response proposed code edits. The current file blocks are authoritative; do not reuse its SEARCH/REPLACE anchors.';
const MODEL_MAX_OUTPUT_TOKENS: Readonly<Record<string, number>> = {
  // OpenRouter currently exposes the model's full 65,536-token completion
  // window. Do not impose the smaller generic harness limit in Study 2.
  'google/gemini-2.5-flash-lite': 65_536,
};

export function codingMaxOutputTokens(model?: string): number {
  return model ? (MODEL_MAX_OUTPUT_TOKENS[model] ?? DEFAULT_MAX_OUTPUT_TOKENS) : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Keep interrupted responses visible in the branch archive, but do not feed
 * their partial (and often repetitive) text back into the next model call.
 * The short replacement preserves conversational ordering without teaching a
 * weak model to continue a degenerate output loop.
 */
export function buildCodingHistoryMessages(history: Message[]): LLMMessage[] {
  const filtered = history.filter(
    m => m.role !== 'system' || m.content.startsWith('[merge]') || m.content.startsWith('[study]')
  );
  const mergeNotes = filtered.filter(m => m.role === 'system');
  const nonSystem = filtered.filter(m => m.role !== 'system');
  const kept = [...mergeNotes, ...nonSystem];

  const normalized = kept.map(m => ({
    role: m.role === 'system' ? 'user' : m.role,
    content: m.role === 'system'
      ? `[context: ${m.content}]`
      : m.role === 'assistant' && m.meta?.interrupted
        ? INTERRUPTED_ASSISTANT_CONTEXT
        : m.role === 'assistant' && m.meta?.artifactIds?.length
          ? EDIT_PROPOSAL_CONTEXT
        : m.content,
  }));
  return normalized;
}

/**
 * A failed edit proposal is itself stale evidence. During the one-shot repair,
 * keep the participant's requests and stable study/merge context, but remove
 * assistant drafts that contain obsolete SEARCH blocks. The repair instruction
 * supplies the failed intent and the latest file contents separately.
 */
export function buildEditRecoveryHistoryMessages(history: Message[]): LLMMessage[] {
  const stable = history.filter(message =>
    message.role === 'user' ||
    (message.role === 'system' &&
      (message.content.startsWith('[merge]') || message.content.startsWith('[study]')))
  );
  const normalized = stable.map(message => ({
    role: 'user' as const,
    content: message.role === 'system' ? `[context: ${message.content}]` : message.content,
  }));
  return normalized;
}

const MIN_REPEATED_EDIT_BLOCK_CHARS = 200;
const REPEATED_EDIT_BLOCK_THRESHOLD = 3;

/**
 * Detect a model repeating the same complete SEARCH/REPLACE edit block. This
 * is deliberately narrow: ordinary prose and distinct edits are never
 * stopped, even when they contain repeated short phrases.
 */
export function hasRepeatedSearchReplaceBlock(
  text: string,
  threshold = REPEATED_EDIT_BLOCK_THRESHOLD,
): boolean {
  const counts = new Map<string, number>();
  const fencedBlock = /```[^\n]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fencedBlock.exec(text)) !== null) {
    const body = match[1].replace(/\r\n/g, '\n').trim();
    if (body.length < MIN_REPEATED_EDIT_BLOCK_CHARS) continue;
    if (!body.includes('<<<<<<< SEARCH') || !body.includes('=======') || !body.includes('>>>>>>> REPLACE')) {
      continue;
    }
    const count = (counts.get(body) ?? 0) + 1;
    if (count >= threshold) return true;
    counts.set(body, count);
  }
  return false;
}

function fileBlock(path: string, content: string): string {
  return `### ${path}\n\`\`\`\n${content}\n\`\`\``;
}

export function buildArtifactContext(
  artifacts: Artifact[],
  workspaceFiles: WorkspaceFileCandidate[],
  selectedFiles: { path: string; content: string }[],
  contextRationale?: string,
  contextSummary?: string,
): string {
  if (!workspaceFiles.length && !artifacts.length) return '';

  const branchByPath = new Map(artifacts.map(a => [a.path, a]));
  const inventory = workspaceFiles.slice(0, MAX_MANIFEST_ENTRIES).map(f => {
    const branch = branchByPath.get(f.path);
    return `  • ${f.path} (${f.size} bytes)${branch ? ' [branch version available]' : ''}${f.symbols.length ? ` — ${f.symbols.join(', ')}` : ''}`;
  }).join('\n');

  const branchOnly = artifacts
    .filter(a => !workspaceFiles.some(f => f.path === a.path))
    .slice(0, MAX_MANIFEST_ENTRIES)
    .map(a => `  • ${a.path} (${a.content.length} bytes) [branch-only]`)
    .join('\n');

  const blocks: string[] = [];
  let total = 0;
  for (const selected of selectedFiles) {
    if (selected.content.length > MAX_FULL_FILE_CHARS) continue;
    if (total + selected.content.length > MAX_TOTAL_SELECTED_CHARS) continue;
    // selectedFiles are resolved immediately before this model call. For the
    // active state they therefore include an intervening manual edit that a
    // file watcher may not yet have captured as an artifact. Never let an old
    // artifact overwrite that fresher, explicitly selected content.
    blocks.push(fileBlock(selected.path, selected.content));
    total += selected.content.length;
  }

  return [
    '',
    'WORKSPACE FILE INVENTORY (authoritative — these files actually exist in the current workspace):',
    inventory || '  (no readable workspace files)',
    branchOnly ? `\nBRANCH-ONLY FILES:\n${branchOnly}` : '',
    '',
    'FILES SELECTED BY THE CONTEXT AGENT — READ THESE AS AUTHORITATIVE CURRENT CONTENT:',
    blocks.length ? blocks.join('\n\n') : '  (none selected)',
    contextSummary ? `CONTEXT AGENT SUMMARY OF THE CONVERSATION: ${contextSummary}` : '',
    contextRationale ? `CONTEXT AGENT RATIONALE: ${contextRationale}` : '',
    '',
    'CONTEXT RULES:',
    '  • The workspace inventory is real; do not ask the user to paste a file that appears there.',
    '  • The selected file blocks contain the actual contents you must use for SEARCH anchors.',
    '  • The selected file blocks are the latest authoritative contents for this call.',
    '  • Follow-up requests such as "fix it then" refer to the conversation history supplied in the messages; infer the relevant files from that context.',
    '  • If you still cannot safely identify the relevant file, say what is ambiguous, but do NOT ask the user to paste contents of a file that is listed in the inventory.',
  ].filter(Boolean).join('\n');
}

// ─── artifact extraction ─────────────────────────────────────────────────────

/**
 * Pull artifact candidates out of an assistant message.
 *
 * Format expected:
 *   ```python
 *   # path: src/auth.py
 *   def login(): ...
 *   ```
 *
 * Or `// path:` for non-Python languages.
 */
export function extractArtifacts(content: string): ArtifactCandidate[] {
  const candidates: ArtifactCandidate[] = [];
  const fenceRe = /```(\w+)\n([\s\S]*?)```/g;
  let match;
  while ((match = fenceRe.exec(content)) !== null) {
    const language = match[1];
    const body = match[2];
    const firstLine = body.split('\n')[0].trim();

    let path: string | null = null;
    const pyPathMatch = firstLine.match(/^#\s*path:\s*(.+)$/);
    const slashPathMatch = firstLine.match(/^\/\/\s*path:\s*(.+)$/);
    if (pyPathMatch) path = pyPathMatch[1].trim();
    else if (slashPathMatch) path = slashPathMatch[1].trim();

    if (path && !isProtectedPath(path)) {
      const contentLines = body.split('\n').slice(1).join('\n');
      candidates.push({ path, content: contentLines, language });
    }
  }
  return candidates;
}
