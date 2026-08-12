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
    /** How many of the most recent messages to send. */
    maxHistory?: number;
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
      opts.artifacts ?? [],
      opts.workspaceFiles ?? [],
      opts.selectedFiles ?? [],
      opts.contextRationale,
      opts.contextSummary,
    );

    // Only send the most recent turns. The authoritative file state travels in
    // the artifact context above, so old turns rarely change the answer and
    // just cost tokens every call. Merge-context system notes are always kept.
    const maxHistory = opts.maxHistory ?? DEFAULT_MAX_HISTORY;
    const filtered = opts.history.filter(
      m => m.role !== 'system' || m.content.startsWith('[merge]') || m.content.startsWith('[study]')
    );
    const mergeNotes = filtered.filter(m => m.role === 'system');
    const recent = filtered.slice(-maxHistory);
    // Re-attach any merge notes that fell outside the recent window (cheap, rare).
    const seen = new Set(recent);
    const kept = [...mergeNotes.filter(m => !seen.has(m)), ...recent];

    const messages: LLMMessage[] = kept.map(m => ({
      role: m.role === 'system' ? 'user' : m.role,
      content: m.role === 'system' ? `[context: ${m.content}]` : m.content,
    }));
    if (opts.repairInstruction) {
      messages.push({ role: 'user', content: opts.repairInstruction });
    }

    yield* this.provider.stream({
      system,
      messages,
      signal: opts.signal,
      model: opts.model,
      maxTokens: 8192, // headroom: multi-block edits were truncating at the 4096 default
    });
  }
}

// ─── authoritative workspace context ───────────────────────────────────────
const MAX_MANIFEST_ENTRIES = 5_000;
const MAX_FULL_FILE_CHARS = 500_000;
const MAX_TOTAL_SELECTED_CHARS = 300_000;
const DEFAULT_MAX_HISTORY = 32;

function fileBlock(path: string, content: string): string {
  return `### ${path}\n\`\`\`\n${content}\n\`\`\``;
}

function buildArtifactContext(
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
    // Branch artifacts are authoritative over disk for the same path.
    const content = branchByPath.get(selected.path)?.content ?? selected.content;
    blocks.push(fileBlock(selected.path, content));
    total += content.length;
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
    '  • If a path is branch-owned, the branch version above overrides the on-disk version.',
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

    if (path) {
      const contentLines = body.split('\n').slice(1).join('\n');
      candidates.push({ path, content: contentLines, language });
    }
  }
  return candidates;
}
