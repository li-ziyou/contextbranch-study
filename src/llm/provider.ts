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
  /** Provider explicitly stopped because the output limit was reached. */
  truncated?: boolean;
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

  constructor(private apiKey: string, private pinnedModel?: string) {}

  async *stream(opts: LLMRequestOptions): AsyncIterable<LLMStreamEvent> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });

    // Anthropic separates system from messages; map accordingly.
    const system = opts.system ?? opts.messages.find(m => m.role === 'system')?.content;
    const messages = opts.messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let inputTokens = 0, outputTokens = 0;
    let truncated = false;

    try {
      const stream = await client.messages.stream({
        model: opts.model ?? this.pinnedModel ?? this.defaultModel,
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
        } else if (event.type === 'message_delta') {
          if ((event as any).usage) outputTokens = (event as any).usage.output_tokens ?? outputTokens;
          const stopReason = (event as any).delta?.stop_reason;
          if (stopReason === 'max_tokens' || stopReason === 'length') truncated = true;
        } else if (event.type === 'message_start' && (event as any).message?.usage) {
          inputTokens = (event as any).message.usage.input_tokens ?? 0;
        }
      }

      yield { type: 'usage', inputTokens, outputTokens };
      yield { type: 'done', truncated };
    } catch (err: any) {
      yield { type: 'error', error: err.message ?? String(err) };
    }
  }
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  private baseURL?: string;
  private headers?: Record<string, string>;
  private pinnedModel?: string;

  constructor(private apiKey: string, opts: {
    name?: string; baseURL?: string; defaultModel?: string;
    headers?: Record<string, string>; pinnedModel?: string;
  } = {}) {
    this.name = opts.name ?? 'openai';
    this.defaultModel = opts.defaultModel ?? 'gpt-4o';
    this.baseURL = opts.baseURL;
    this.headers = opts.headers;
    this.pinnedModel = opts.pinnedModel;
  }

  async *stream(opts: LLMRequestOptions): AsyncIterable<LLMStreamEvent> {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey: this.apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      ...(this.headers ? { defaultHeaders: this.headers } : {}),
    });

    const messages: any[] = [];
    if (opts.system) messages.push({ role: 'system', content: opts.system });
    for (const m of opts.messages) {
      if (m.role === 'system' && opts.system) continue;
      messages.push({ role: m.role, content: m.content });
    }

    // Transient upstream errors (503 overloaded, 502/429, dropped sockets) are
    // common on routed providers like OpenRouter. Retry a few times — but ONLY
    // before any text has streamed, so we never stitch two partial replies into
    // a Frankenstein answer.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let sawDelta = false;
      let inputTokens = 0, outputTokens = 0;
      let truncated = false;
      try {
        const stream = await client.chat.completions.create({
          model: opts.model ?? this.pinnedModel ?? this.defaultModel,
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
          const choice = chunk.choices[0];
          if (choice?.finish_reason === 'length') truncated = true;
          const delta = choice?.delta?.content;
          if (delta) { sawDelta = true; yield { type: 'delta', text: delta }; }
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens ?? 0;
            outputTokens = chunk.usage.completion_tokens ?? 0;
          }
        }

        yield { type: 'usage', inputTokens, outputTokens };
        yield { type: 'done', truncated };
        return;
      } catch (err: any) {
        const canRetry = !sawDelta && attempt < maxAttempts && isTransientError(err);
        if (!canRetry) {
          const hint = isTransientError(err)
            ? ' (the provider was overloaded/dropped the stream — try again, or switch contextbranch.model to a more reliable route)'
            : '';
          yield { type: 'error', error: `${err.message ?? String(err)}${hint}` };
          return;
        }
        await new Promise(r => setTimeout(r, 500 * attempt)); // 0.5s, 1s backoff
      }
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

/**
 * Transient = worth retrying: rate limits PLUS server-side overloads (502/503/
 * 500/529), "overloaded", and dropped connections. These are common on routed
 * providers (OpenRouter) when an upstream is busy.
 */
function isTransientError(err: unknown): boolean {
  if (isRateLimitError(err)) return true;
  const status = (err as any)?.status ?? (err as any)?.statusCode;
  if (status === 500 || status === 502 || status === 503 || status === 529) return true;
  const msg = String((err as any)?.message ?? err);
  return /\b(500|502|503|529)\b/.test(msg)
    || /overloaded/i.test(msg)
    || /service unavailable|temporarily unavailable|bad gateway/i.test(msg)
    || /ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|terminated|stream (?:ended|closed)/i.test(msg);
}

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly defaultModel = 'gemini-3.1-flash-lite-preview';

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

  constructor(private apiKey: string, private pinnedModel?: string) {}

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

    const candidates = opts.model ? [opts.model]
      : (this.pinnedModel ? [this.pinnedModel] : this.fallbackModels);

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
      let truncated = false;

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
        const finishReason = String(finalResp.candidates?.[0]?.finishReason ?? '');
        truncated = /MAX_TOKENS|LENGTH/i.test(finishReason);

        yield { type: 'usage', inputTokens, outputTokens };
        yield { type: 'done', truncated };
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

export function createProvider(name: string, apiKey: string, model?: string): LLMProvider {
  const pinned = model && model.trim() ? model.trim() : undefined;
  switch (name) {
    case 'anthropic': return new AnthropicProvider(apiKey, pinned);
    case 'openai': return new OpenAIProvider(apiKey, { pinnedModel: pinned });
    case 'openrouter': return new OpenAIProvider(apiKey, {
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      // Cheap, reliable, and strong at following the exact edit format. Override
      // via `contextbranch.model` (e.g. "deepseek/deepseek-chat" for cheapest,
      // "anthropic/claude-sonnet-4.6" for top quality).
      defaultModel: 'anthropic/claude-haiku-4.5',
      headers: { 'HTTP-Referer': 'https://github.com/contextbranch', 'X-Title': 'ContextBranch' },
      pinnedModel: pinned,
    });
    case 'gemini': return new GeminiProvider(apiKey, pinned);
    default: throw new Error(`Unknown provider: ${name}`);
  }
}
