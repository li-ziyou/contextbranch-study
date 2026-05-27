/**
 * Meta Agent observes the full graph and surfaces patterns based on triggers. (ChatGraPhT).
 */

import { LLMProvider } from '../llm/provider';
import {
  META_AGENT_SYSTEM, CONSOLIDATION_SYSTEM,
  REBASE_CHECK_SYSTEM, CONSISTENCY_CHECK_SYSTEM
} from '../llm/prompts';
import { Branch, Message } from '../core/types';

export type MetaTrigger =
  | 'branch_created'
  | 'merge_attempted'
  | 'merge_completed'
  | 'user_request';

export interface MetaSuggestion {
  shouldSpeak: boolean;
  tone?: 'brief' | 'warning' | 'suggestion';
  message?: string;
  suggestedActions?: { label: string; kind: string; branch?: string }[];
}

export class MetaAgent {
  constructor(private provider: LLMProvider) {}

  // event-triggered observation 

  async observe(opts: {
    trigger: MetaTrigger;
    branches: Branch[];
    activeBranch: Branch;
    recentMessages?: Message[];
    userQuery?: string;
    signal?: AbortSignal;
  }): Promise<MetaSuggestion> {
    const context = this.buildGraphContext(opts.branches, opts.activeBranch);
    const userContent = [
      `Trigger: ${opts.trigger}`,
      `Active branch: ${opts.activeBranch.name}`,
      '',
      'Branch graph:',
      context,
      opts.userQuery ? `\nUser query: ${opts.userQuery}` : '',
    ].join('\n');

    let raw = '';
    for await (const ev of this.provider.stream({
      system: META_AGENT_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 800,
      temperature: 0.4,
      signal: opts.signal,
    })) {
      if (ev.type === 'delta') raw += ev.text;
      if (ev.type === 'error') return { shouldSpeak: false };
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { shouldSpeak: false };
    try {
      return JSON.parse(jsonMatch[0]) as MetaSuggestion;
    } catch {
      return { shouldSpeak: false };
    }
  }

  // at merge

  async consolidate(branch: Branch, messages: Message[],
                    signal?: AbortSignal): Promise<string> {
    const transcript = messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const userContent =
      `Branch: ${branch.name}\n` +
      `Description: ${branch.description ?? '(none)'}\n\n` +
      `Conversation:\n${transcript}`;

    let raw = '';
    for await (const ev of this.provider.stream({
      system: CONSOLIDATION_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 1500,
      temperature: 0.3,
      signal,
    })) {
      if (ev.type === 'delta') raw += ev.text;
      if (ev.type === 'error') throw new Error(`Consolidation failed: ${ev.error}`);
    }
    return raw.trim();
  }

  // consistency checks

  async rebaseCheck(source: Branch, target: Branch,
                    sourceMessages: Message[], targetMessages: Message[],
                    signal?: AbortSignal): Promise<string[]> {
    const userContent =
      `SOURCE branch: ${source.name}\n` +
      `Source conversation:\n` +
      sourceMessages.slice(-20).map(m => `${m.role}: ${m.content}`).join('\n') +
      `\n\nTARGET branch: ${target.name}\n` +
      `Target recent additions:\n` +
      targetMessages.slice(-15).map(m => `${m.role}: ${m.content}`).join('\n');

    let raw = '';
    for await (const ev of this.provider.stream({
      system: REBASE_CHECK_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 800,
      temperature: 0.2,
      signal,
    })) {
      if (ev.type === 'delta') raw += ev.text;
      if (ev.type === 'error') return [];
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed.warnings) ? parsed.warnings : [];
    } catch { return []; }
  }

  // consistency check on merged state

  async consistencyCheck(target: Branch, mergedMessages: Message[],
                          signal?: AbortSignal): Promise<string[]> {
    const userContent =
      `Target branch after merge: ${target.name}\n\n` +
      mergedMessages.slice(-25).map(m => `${m.role}: ${m.content}`).join('\n');

    let raw = '';
    for await (const ev of this.provider.stream({
      system: CONSISTENCY_CHECK_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      maxTokens: 600,
      temperature: 0.2,
      signal,
    })) {
      if (ev.type === 'delta') raw += ev.text;
      if (ev.type === 'error') return [];
    }
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return Array.isArray(parsed.warnings) ? parsed.warnings : [];
    } catch { return []; }
  }

  private buildGraphContext(branches: Branch[], active: Branch): string {
    return branches.map(b => {
      const tag = b.id === active.id ? ' (ACTIVE)' : '';
      const parent = b.parentBranchId ? ` ← ${b.parentBranchId}` : '';
      return `  - ${b.name} [${b.status}]${tag}${parent} (${b.messageIds.length} msgs)`;
    }).join('\n');
  }
}
