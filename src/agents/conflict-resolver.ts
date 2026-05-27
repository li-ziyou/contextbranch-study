/**
 * ConflictResolver Agent is responsible for resolving in-file conflicts when both branches
 * edit the same file in incompatible ways.  Given the base, theirs, ours, and recent messages
 * from both branches, it produces a unified resolution. 
 * The user reviews each resolution and chooses to accept or fall back to manual conflict markers.
 */

import { LLMProvider } from '../llm/provider';
import { CONFLICT_RESOLVER_SYSTEM } from '../llm/prompts';

export interface ConflictResolution {
  path: string;
  resolvedContent: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  // diff display
  originalContent: string;
  // fallback to textual conflict markers
  error?: string;
}

export class ConflictResolverAgent {
  constructor(private provider: LLMProvider) {}

  async resolve(opts: {
    path: string;
    base: string;
    theirs: string;
    ours: string;
    theirContext: { role: string; content: string }[];
    ourContext: { role: string; content: string }[];
    signal?: AbortSignal;
  }): Promise<ConflictResolution> {
    const userContent = this.buildUserMessage(opts);

    let raw = '';
    try {
      for await (const ev of this.provider.stream({
        system: CONFLICT_RESOLVER_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
        maxTokens: 4096,
        temperature: 0.1, // low to be more deterministic 
        signal: opts.signal,
      })) {
        if (ev.type === 'delta') raw += ev.text;
        if (ev.type === 'error') {
          return this.errorResult(opts.path, opts.theirs, ev.error ?? 'unknown error');
        }
      }
    } catch (err: any) {
      return this.errorResult(opts.path, opts.theirs, err.message ?? String(err));
    }

    return this.parse(raw, opts.path, opts.theirs);
  }

  // prompt generation

  private buildUserMessage(opts: {
    path: string;
    base: string;
    theirs: string;
    ours: string;
    theirContext: { role: string; content: string }[];
    ourContext: { role: string; content: string }[];
  }): string {
    const parts: string[] = [];
    parts.push(`path: ${opts.path}\n`);

    parts.push('=== BASE (common ancestor) ===');
    parts.push(opts.base || '<file did not exist at fork point>');

    parts.push('\n=== THEIRS (target branch current) ===');
    parts.push(opts.theirs || '<file does not exist in target>');

    parts.push('\n=== OURS (source branch current) ===');
    parts.push(opts.ours);

    if (opts.theirContext.length > 0) {
      parts.push('\n=== TARGET BRANCH INTENT (recent messages) ===');
      for (const m of opts.theirContext.slice(-4)) {
        const snippet = m.content.length > 600 ? m.content.slice(0, 600) + '…' : m.content;
        parts.push(`[${m.role}] ${snippet}`);
      }
    }

    if (opts.ourContext.length > 0) {
      parts.push('\n=== SOURCE BRANCH INTENT (recent messages) ===');
      for (const m of opts.ourContext.slice(-4)) {
        const snippet = m.content.length > 600 ? m.content.slice(0, 600) + '…' : m.content;
        parts.push(`[${m.role}] ${snippet}`);
      }
    }

    parts.push(
      '\n=== TASK ===',
      'Produce a unified resolution as strict JSON. No markdown, no commentary.',
    );

    return parts.join('\n');
  }

  private parse(raw: string, path: string, theirs: string): ConflictResolution {
    const json = extractJson(raw);
    if (!json || typeof json.resolvedContent !== 'string') {
      return this.errorResult(path, theirs, 'Resolver response was not parseable JSON. Raw start: ' + raw.slice(0, 200));
    }

    const conf = json.confidence;
    const confidence: 'high' | 'medium' | 'low' =
      conf === 'high' || conf === 'medium' || conf === 'low' ? conf : 'medium';

    return {
      path,
      resolvedContent: json.resolvedContent,
      rationale: typeof json.rationale === 'string' ? json.rationale : '',
      confidence,
      originalContent: theirs,
    };
  }

  private errorResult(path: string, theirs: string, error: string): ConflictResolution {
    return {
      path,
      resolvedContent: theirs, // fallback leave target unchanged
      rationale: '',
      confidence: 'low',
      originalContent: theirs,
      error,
    };
  }
}

// duplicated from merge-analyst to avoid a dependency between agents

function extractJson(raw: string): any | null {
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]); } catch {}
  }

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
