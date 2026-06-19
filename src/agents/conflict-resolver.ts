/**
 * ConflictResolver Agent is responsible for resolving in-file conflicts when both branches
 * edit the same file in incompatible ways.  Given the base, theirs, ours, and recent messages
 * from both branches, it produces a unified resolution. 
 * The user reviews each resolution and chooses to accept or fall back to manual conflict markers.
 */

import { LLMProvider } from '../llm/provider';
import { CONFLICT_RESOLVER_SYSTEM } from '../llm/prompts';
import { parseEdits, looksElided, merge3 } from '../core/edits';

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
  constructor(
    private provider: LLMProvider,
    private onUsage?: (inputTokens: number, outputTokens: number) => void,
  ) {}

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
        maxTokens: 8192,
        temperature: 0.1, // low to be more deterministic 
        signal: opts.signal,
      })) {
        if (ev.type === 'delta') raw += ev.text;
        if (ev.type === 'usage') this.onUsage?.(ev.inputTokens ?? 0, ev.outputTokens ?? 0);
        if (ev.type === 'error') {
          return this.fallback(opts, ev.error ?? 'unknown error');
        }
      }
    } catch (err: any) {
      return this.fallback(opts, err.message ?? String(err));
    }

    return this.parse(raw, opts);
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
      'Resolve the conflict and output the result in the CONFIDENCE/RATIONALE + fenced-block format from your instructions. No JSON.',
    );

    return parts.join('\n');
  }

  private parse(raw: string, opts: { path: string; base: string; theirs: string; ours: string }): ConflictResolution {
    // The resolved file comes back as a fenced `# path:` block — parse it with
    // the same robust engine the coding agent uses (no JSON escaping of code).
    const ops = parseEdits(raw);
    const match = ops.find(o => o.kind === 'create' && o.path === opts.path && typeof o.content === 'string');
    const anyCreate = ops.find(o => o.kind === 'create' && typeof o.content === 'string');
    const content = (match ?? anyCreate)?.content;

    const confRaw = (raw.match(/CONFIDENCE:\s*(high|medium|low)/i)?.[1] ?? 'medium').toLowerCase();
    const confidence = (confRaw === 'high' || confRaw === 'low') ? confRaw as 'high' | 'low' : 'medium';
    const rationale = raw.match(/RATIONALE:\s*(.+)/i)?.[1]?.trim() ?? '';

    if (typeof content !== 'string' || content.trim() === '') {
      return this.fallback(opts, 'Resolver did not return a usable file block. Raw start: ' + raw.slice(0, 160));
    }
    // Safety: refuse a resolution that still has conflict markers or looks elided.
    if (/<{5,}|>{5,}/.test(content) || looksElided(content, opts.theirs)) {
      return this.fallback(opts, 'Resolved content looked incomplete; keeping conflict markers for manual review.');
    }

    return {
      path: opts.path,
      resolvedContent: content,
      rationale,
      confidence,
      originalContent: opts.theirs,
    };
  }

  /**
   * On ANY failure, fall back to a real 3-way merge with conflict markers — NOT
   * to "theirs" (which would silently drop the source branch's work). The user
   * sees a normally-conflicted file they can resolve by hand.
   */
  private fallback(opts: { path: string; base: string; theirs: string; ours: string }, error: string): ConflictResolution {
    const merged = merge3(opts.base, opts.theirs, opts.ours, { ours: 'target', theirs: 'source' });
    return {
      path: opts.path,
      resolvedContent: merged.text,
      rationale: '',
      confidence: 'low',
      originalContent: opts.theirs,
      error,
    };
  }
}
