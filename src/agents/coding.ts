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
    const system = baseSystem + buildArtifactContext(opts.artifacts ?? [], recentUserText);

    const messages: LLMMessage[] = opts.history
      .filter(m => m.role !== 'system' || m.content.startsWith('[merge]'))
      .map(m => ({
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

// ─── bounded artifact context (Task D) ───────────────────────────────────────
const ARTIFACT_CONTEXT_BUDGET = 24_000; // chars of full file content per prompt

function buildArtifactContext(artifacts: Artifact[], recentUserText: string): string {
  if (!artifacts.length) return '';

  // 1) Manifest of EVERY tracked file — cheap, so the model always knows what
  //    exists even when we don't inline the content.
  const manifest = artifacts
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(a => `  • ${a.path} (${a.content.length} bytes)`)
    .join('\n');

  // 2) Inline full content only for a bounded subset:
  //    (a) files referenced by path/name in the last few user turns, then
  //    (b) most-recently-changed files, until the byte budget runs out.
  const lower = recentUserText.toLowerCase();
  const referenced = new Set<string>();
  for (const a of artifacts) {
    const base = a.path.split('/').pop() ?? a.path;
    if (lower.includes(a.path.toLowerCase()) || lower.includes(base.toLowerCase())) {
      referenced.add(a.id);
    }
  }
  const ordered = artifacts.slice().sort((a, b) => {
    const ra = referenced.has(a.id) ? 1 : 0;
    const rb = referenced.has(b.id) ? 1 : 0;
    if (ra !== rb) return rb - ra;        // referenced first
    return b.updatedAt - a.updatedAt;     // then most recently changed
  });

  const included: string[] = [];
  let budget = ARTIFACT_CONTEXT_BUDGET;
  for (const a of ordered) {
    if (a.content.length > budget) continue;
    budget -= a.content.length;
    included.push(`### ${a.path}\n\`\`\`\n${a.content}\n\`\`\``);
  }

  return [
    '',
    'TRACKED FILES IN THIS BRANCH (authoritative — prefer these over memory):',
    manifest,
    '',
    'CONTENTS OF THE MOST RELEVANT TRACKED FILES:',
    included.length ? included.join('\n\n') : '  (none inlined this turn — ask to reference a file if needed)',
    '',
    'If a file is listed above but its contents are not shown, ask the user to reference it rather than guessing its contents.',
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