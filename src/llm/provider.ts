/**
 * Provider-agnostic LLM interface with streaming and abort support.
 *
 * All providers expose `stream()`. Callers can pass an AbortSignal to cancel
 * (e.g., when the user switches branches mid-generation).
 */

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMRequestOptions {
  messages: LLMMessage[];
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface LLMStreamEvent {
  type: 'delta' | 'done' | 'error' | 'usage';
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  stream(opts: LLMRequestOptions): AsyncIterable<LLMStreamEvent>;
}

// ─── Anthropic ───────────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly defaultModel = 'claude-sonnet-4-6';

  constructor(private apiKey: string) {}

  async *stream(opts: LLMRequestOptions): AsyncIterable<LLMStreamEvent> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    // Anthropic separates system from messages; map accordingly.
    const system = opts.system ?? opts.messages.find(m => m.role === 'system')?.content;
    const messages = opts.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let inputTokens = 0, outputTokens = 0;

    try {
      const stream = await client.messages.stream({
        model: opts.model ?? this.defaultModel,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
        system,
        messages,
      });

      for await (const event of stream) {
        if (opts.signal?.aborted) {
          yield { type: 'error', error: 'aborted' };
          return;
        }
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'delta', text: event.delta.text };
        } else if (event.type === 'message_delta' && (event as any).usage) {
          outputTokens = (event as any).usage.output_tokens ?? outputTokens;
        } else if (event.type === 'message_start' && (event as any).message?.usage) {
          inputTokens = (event as any).message.usage.input_tokens ?? 0;
        }
      }

      yield { type: 'usage', inputTokens, outputTokens };
      yield { type: 'done' };
    } catch (err: any) {
      yield { type: 'error', error: err.message ?? String(err) };
    }
  }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  readonly defaultModel = 'gpt-4o';

  constructor(private apiKey: string) {}

  async *stream(opts: LLMRequestOptions): AsyncIterable<LLMStreamEvent> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });

    const messages: any[] = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    for (const m of opts.messages) {
      if (m.role === 'system' && opts.system) continue;
      messages.push({ role: m.role, content: m.content });
    }

    let inputTokens = 0, outputTokens = 0;

    try {
      const stream = await client.chat.completions.create({
        model: opts.model ?? this.defaultModel,
        messages,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.7,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        if (opts.signal?.aborted) {
          yield { type: 'error', error: 'aborted' };
          return;
        }
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield { type: 'delta', text: delta };
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      }

      yield { type: 'usage', inputTokens, outputTokens };
      yield { type: 'done' };
    } catch (err: any) {
      yield { type: 'error', error: err.message ?? String(err) };
    }
  }
}

// ─── Google Gemini ───────────────────────────────────────────────────────────

/**
 * Detect rate-limit / quota errors from any provider's exception shape.
 * Gemini surfaces 429s as plain messages containing the URL + body, so we
 * pattern-match on the strings that actually appear in the wild.
 */
function isRateLimitError(err: unknown): boolean {
  if (!err) return false;
  const msg = String((err as any)?.message ?? err);
  return /\b429\b/.test(msg)
    || /Too Many Requests/i.test(msg)
    || /exceeded your current quota/i.test(msg)
    || /RESOURCE_EXHAUSTED/i.test(msg)
    || /rate.?limit/i.test(msg);
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly defaultModel = 'gemini-3-flash-preview';

  /**
   * Models tried in order when `opts.model` is not pinned by the caller.
   * Gemini 3 Flash has only 20 free RPD; 3.1 Flash Lite has 500. Falling
   * back keeps the demo alive after the daily Flash quota is exhausted.
   * If the user explicitly sets `contextbranch.model`, we honor that
   * single model with no fallback.
   */
  readonly fallbackModels = [
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
  ];

  constructor(private apiKey: string) {}

  /**
   * Dynamically import the Google SDK. Extracted as a method so tests can
   * subclass GeminiProvider and inject a mock without touching network.
   */
  protected async loadSdk(): Promise<{ GoogleGenerativeAI: any }> {
    return await import('@google/generative-ai');
  }

  async *stream(opts: LLMRequestOptions): AsyncIterable<LLMStreamEvent> {
    const { GoogleGenerativeAI } = await this.loadSdk();
    const client = new GoogleGenerativeAI(this.apiKey);

    const candidates = opts.model ? [opts.model] : this.fallbackModels;

    const contents = opts.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    for (let i = 0; i < candidates.length; i++) {
      const modelName = candidates[i];
      const isLast = i === candidates.length - 1;
      let sawDelta = false;
      let caught: any = null;

      try {
        const model = client.getGenerativeModel({
          model: modelName,
          systemInstruction: opts.system,
        });

        const result = await model.generateContentStream({
          contents,
          generationConfig: {
            maxOutputTokens: opts.maxTokens ?? 4096,
            temperature: opts.temperature ?? 0.7,
          },
        });

        for await (const chunk of result.stream) {
          if (opts.signal?.aborted) {
            yield { type: 'error', error: 'aborted' };
            return;
          }
          const text = chunk.text();
          if (text) {
            sawDelta = true;
            yield { type: 'delta', text };
          }
        }

        const finalResp = await result.response;
        const usage = finalResp.usageMetadata;
        const inputTokens = usage?.promptTokenCount ?? 0;
        const outputTokens = usage?.candidatesTokenCount ?? 0;

        yield { type: 'usage', inputTokens, outputTokens };
        yield { type: 'done' };
        return; // success — exit the entire stream
      } catch (err: any) {
        caught = err;
      }

      // Failure path. We can only retry if (a) we never emitted a delta on
      // this attempt — otherwise the next model would produce a Frankenstein
      // reply — (b) we have a candidate left, and (c) it's a rate-limit
      // error specifically (not a malformed request, auth issue, etc.).
      const canRetry = !sawDelta && !isLast && isRateLimitError(caught);
      if (!canRetry) {
        yield { type: 'error', error: caught?.message ?? String(caught) };
        return;
      }

      // Tell the user we're falling back. Emitted as a delta so it shows
      // up in the conversation transcript — useful for the study log.
      const next = candidates[i + 1];
      yield {
        type: 'delta',
        text: `_[${modelName} rate-limited — falling back to ${next}]_\n\n`,
      };
    }
  }
}

// ─── factory ─────────────────────────────────────────────────────────────────

export function createProvider(name: string, apiKey: string): LLMProvider {
  switch (name) {
    case 'anthropic': return new AnthropicProvider(apiKey);
    case 'openai': return new OpenAIProvider(apiKey);
    case 'gemini': return new GeminiProvider(apiKey);
    default: throw new Error(`Unknown provider: ${name}`);
  }
}
