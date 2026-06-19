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
    /** Char budget for files the user referenced this turn. */
    hotContextChars?: number;
    /** Char budget when the user referenced no file (vague request). */
    coldContextChars?: number;
    /** How many of the most recent messages to send. */
    maxHistory?: number;
  }): AsyncIterable<LLMStreamEvent> {
    const baseSystem = codingAgentSystem({
      branchName: opts.branch.name,
      branchDescription: opts.branch.description,
      parentBranchName: opts.parentBranchName,
      isMain: opts.isMain,
      workspaceRoot: opts.workspaceRoot,
    });
    const recentUserText = opts.history
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content)
      .join('\n');
    const system = baseSystem + buildArtifactContext(
      opts.artifacts ?? [],
      recentUserText,
      opts.hotContextChars ?? DEFAULT_HOT_BUDGET,
      opts.coldContextChars ?? DEFAULT_COLD_BUDGET,
    );

    // Only send the most recent turns. The authoritative file state travels in
    // the artifact context above, so old turns rarely change the answer and
    // just cost tokens every call. Merge-context system notes are always kept.
    const maxHistory = opts.maxHistory ?? DEFAULT_MAX_HISTORY;
    const filtered = opts.history.filter(
      m => m.role !== 'system' || m.content.startsWith('[merge]')
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

    yield* this.provider.stream({
      system,
      messages,
      signal: opts.signal,
      model: opts.model,
    });
  }
}

// ─── bounded artifact context ────────────────────────────────────────────────
const DEFAULT_HOT_BUDGET = 14_000;  // chars of file content when files are referenced
const DEFAULT_COLD_BUDGET = 6_000;  // chars when the request names no file
const DEFAULT_MAX_HISTORY = 16;     // most recent messages to send
const MAX_MANIFEST_ENTRIES = 200;   // cap the cheap file list for huge repos

// Stopwords so common English/instruction words don't match every file.
const REF_STOPWORDS = new Set([
  'please','update','change','make','file','code','using','where','which','that',
  'this','with','from','into','your','have','should','would','could','about',
  'style','styles','styling','color','colour','button','buttons','these','those',
  'their','there','here','when','what','then','than','also','like','need','want',
  'function','const','class','return','import','export','value','values','consistent',
]);

/**
 * Pull distinctive tokens out of the user's text for content-based file routing:
 *   • CSS-ish selectors: ".move-btn", "#sidebar"
 *   • code-like identifiers: snake_case, kebab-case, camelCase, dotted members
 * Plain English words are dropped (stopwords / not code-like) so we don't end up
 * matching every file.
 */
function extractRefTokens(text: string): string[] {
  const out = new Set<string>();
  // selectors / dotted members like .move-btn, #app, obj.method
  for (const m of text.matchAll(/[.#]([A-Za-z][\w-]{2,})/g)) out.add(m[1].toLowerCase());
  // bare identifiers
  for (const m of text.matchAll(/\b([A-Za-z_][\w-]{3,})\b/g)) {
    const tok = m[1];
    const low = tok.toLowerCase();
    if (REF_STOPWORDS.has(low)) continue;
    const codey = /[_-]/.test(tok) || /[a-z][A-Z]/.test(tok); // snake/kebab/camel
    if (codey || tok.length >= 5) out.add(low);
  }
  return [...out].filter(t => t.length >= 3);
}

function fileBlock(a: Artifact): string {
  return `### ${a.path}\n\`\`\`\n${a.content}\n\`\`\``;
}

function buildArtifactContext(
  artifacts: Artifact[],
  recentUserText: string,
  hotBudget: number,
  coldBudget: number,
): string {
  if (!artifacts.length) return '';

  // 1) Manifest of tracked files — cheap, so the model always knows what
  //    exists even when we don't inline content.
  const sorted = artifacts.slice().sort((a, b) => a.path.localeCompare(b.path));
  const manifestList = sorted.slice(0, MAX_MANIFEST_ENTRIES)
    .map(a => `  • ${a.path} (${a.content.length} bytes)`)
    .join('\n');
  const manifest = sorted.length > MAX_MANIFEST_ENTRIES
    ? `${manifestList}\n  • …and ${sorted.length - MAX_MANIFEST_ENTRIES} more`
    : manifestList;

  // 2) Which files did the user actually reference this turn? Match by path,
  //    by basename, AND by distinctive code tokens (CSS selectors, identifiers,
  //    function names) found in file CONTENTS — so ".move-btn" pulls in the
  //    file that defines/uses it even if the path was never typed.
  const lower = recentUserText.toLowerCase();
  const tokens = extractRefTokens(recentUserText);
  const referenced = new Set<string>();
  for (const a of artifacts) {
    const base = (a.path.split('/').pop() ?? a.path).toLowerCase();
    if (lower.includes(a.path.toLowerCase()) || lower.includes(base)) {
      referenced.add(a.id);
      continue;
    }
    const hay = a.content.toLowerCase();
    for (const tok of tokens) {
      if (hay.includes(tok)) { referenced.add(a.id); break; }
    }
  }

  const byRecent = artifacts.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const included: string[] = [];
  let note: string;

  if (referenced.size > 0) {
    // HOT path: inline ONLY the referenced files (no padding with unrelated
    // files — that was the main token waste).
    let budget = hotBudget;
    for (const a of byRecent) {
      if (!referenced.has(a.id)) continue;
      if (a.content.length > budget) continue;
      budget -= a.content.length;
      included.push(fileBlock(a));
    }
    note = 'Inlined the file(s) you referenced. Everything else is in the manifest above — name a file to pull its full contents in.';
  } else {
    // COLD path: no file named → inline only a small slice of the most
    // recently changed files, within a tight budget.
    let budget = coldBudget;
    for (const a of byRecent) {
      if (a.content.length > budget) continue;
      budget -= a.content.length;
      included.push(fileBlock(a));
    }
    note = 'No specific file was referenced, so only the most recently changed file(s) are inlined (small budget). Name a file to pull its full contents in.';
  }

  return [
    '',
    'TRACKED FILES IN THIS BRANCH (authoritative — prefer these over memory):',
    manifest,
    '',
    'CONTENTS OF THE RELEVANT TRACKED FILES:',
    included.length ? included.join('\n\n') : '  (none inlined this turn)',
    '',
    note,
  ].join('\n');
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