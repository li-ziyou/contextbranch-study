/**
 * MergeAnalyst Agent is always invoked at merge and isresponsible for proposing cascading cross-file edits.
 * When the source branch changes one file in a way that other files (in the target branch) the agent
 * detects the implication and proposes edits as artifact replacements.
 * The user reviews each proposal as a checkbox in the merge preview and chooses which to accept. 
 * Accepted proposals become artifacts in the target.
 */

import { LLMProvider } from '../llm/provider';
import { MERGE_ANALYST_SYSTEM } from '../llm/prompts';

export interface CascadingEditProposal {
  path: string;
  rationale: string;
  proposedContent: string;
  // for diff display only
  currentContent: string;
}


export interface AnalystResult {
  summary: string;
  proposals: CascadingEditProposal[];
  error?: string;
}

interface ArtifactView {
  path: string;
  content: string;
}

interface ChangedFileView {
  path: string;
  before: string; // target's current content 
  after: string;  // source's content
  status: 'add' | 'modify' | 'conflict';
}

export class MergeAnalystAgent {
  constructor(private provider: LLMProvider) {}

  async analyze(opts: {
    sourceArtifacts: ArtifactView[];
    targetArtifacts: ArtifactView[];
    changedFiles: ChangedFileView[];
    recentMessages?: { role: string; content: string }[];
    signal?: AbortSignal;
    maxProposals?: number;
  }): Promise<AnalystResult> {
    const max = opts.maxProposals ?? 4;

    if (opts.changedFiles.length === 0) {
      return { summary: 'No changes in source — nothing to cascade.', proposals: [] };
    }

    // those are the only paths it's allowed to propose edits to.
    const changedPaths = new Set(opts.changedFiles.map(f => f.path));
    const unchangedTarget = opts.targetArtifacts.filter(a => !changedPaths.has(a.path));

    if (unchangedTarget.length === 0) {
      return { summary: 'No unchanged target files to consider.', proposals: [] };
    }

    const userContent = this.buildUserMessage(
      opts.sourceArtifacts,
      unchangedTarget,
      opts.changedFiles,
      opts.recentMessages,
      max,
    );

    let raw = '';
    try {
      for await (const ev of this.provider.stream({
        system: MERGE_ANALYST_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
        maxTokens: 4096,
        temperature: 0.2,
        signal: opts.signal,
      })) {
        if (ev.type === 'delta') raw += ev.text;
        if (ev.type === 'error') {
          return { summary: '', proposals: [], error: ev.error };
        }
      }
    } catch (err: any) {
      return { summary: '', proposals: [], error: err.message ?? String(err) };
    }

    return this.parse(raw, opts.targetArtifacts);
  }

  // promp generation
  private buildUserMessage(
    source: ArtifactView[],
    unchangedTarget: ArtifactView[],
    changed: ChangedFileView[],
    recentMessages: { role: string; content: string }[] | undefined,
    maxProposals: number,
  ): string {
    const parts: string[] = [];

    parts.push(`MAX PROPOSALS: ${maxProposals}\n`);

    parts.push('=== CHANGED FILES (these are the trigger; do not propose edits to these) ===');
    for (const f of changed) {
      parts.push(`\n--- ${f.path} (status: ${f.status}) ---`);
      parts.push('TARGET (before):');
      parts.push(f.before || '<file does not exist in target>');
      parts.push('\nSOURCE (after):');
      parts.push(f.after);
    }

    parts.push('\n=== UNCHANGED TARGET FILES (you may propose edits to these) ===');
    if (unchangedTarget.length === 0) {
      parts.push('(none)');
    } else {
      for (const a of unchangedTarget) {
        parts.push(`\n--- ${a.path} ---`);
        parts.push(a.content);
      }
    }

    if (recentMessages && recentMessages.length > 0) {
      parts.push('\n=== RECENT CONVERSATION (most recent last; for context only) ===');
      for (const m of recentMessages.slice(-6)) {
        // Shorten long messages 
        const snippet = m.content.length > 800 ? m.content.slice(0, 800) + '…' : m.content;
        parts.push(`[${m.role}] ${snippet}`);
      }
    }

    parts.push(
      '\n=== TASK ===',
      'Identify which UNCHANGED TARGET FILES need updates to remain consistent with the CHANGED FILES.',
      'For each, return the complete new file content. Be concrete — no placeholders, no ellipses.',
      'Output the JSON described in your system prompt and nothing else.',
    );

    return parts.join('\n');
  }

  private parse(raw: string, targetArtifacts: ArtifactView[]): AnalystResult {
    const json = extractJson(raw);
    if (!json) {
      return {
        summary: '',
        proposals: [],
        error: 'Analyst response was not parseable JSON. Raw start: ' + raw.slice(0, 200),
      };
    }

    const summary = typeof json.summary === 'string' ? json.summary : '';
    const proposalsRaw = Array.isArray(json.proposals) ? json.proposals : [];

    // look up current content from the target so the UI can render a diff
    const targetByPath = new Map<string, string>();
    for (const a of targetArtifacts) targetByPath.set(a.path, a.content);

    const proposals: CascadingEditProposal[] = [];
    for (const p of proposalsRaw) {
      if (!p || typeof p.path !== 'string' || typeof p.proposedContent !== 'string') continue;
      const currentContent = targetByPath.get(p.path) ?? '';
      if (p.proposedContent.trim() === currentContent.trim()) continue;
      proposals.push({
        path: p.path,
        rationale: typeof p.rationale === 'string' ? p.rationale : '',
        proposedContent: p.proposedContent,
        currentContent,
      });
    }

    return { summary, proposals };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Pulls a JSON object out of LLM output, tolerant of markdown fences and
 * surrounding prose. We ask for strict JSON in the prompt but providers don't
 * always comply, especially the smaller free-tier models.
 */
function extractJson(raw: string): any | null {
  const trimmed = raw.trim();
  // Try direct parse first.
  try { return JSON.parse(trimmed); } catch {}

  // Strip markdown code fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }

  // Fall back to grabbing the first top-level {...} block.
  const start = trimmed.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try { return JSON.parse(candidate); } catch { return null; }
      }
    }
  }
  return null;
}
