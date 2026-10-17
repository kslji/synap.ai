/**
 * Minimal client for llama-server's OpenAI-compatible API (main process) + the tool-calling loop.
 * Qwen3.5 thinks by default; for snappy chat on laptops we turn thinking OFF per request with
 * chat_template_kwargs.enable_thinking=false and use Qwen's recommended non-thinking sampling.
 */
import { parseModelJson } from '../../shared/model-output.js';
import { createStreamJoiner } from '../../shared/reply-text.js';

export type Role = 'system' | 'user' | 'assistant' | 'tool';
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ChatMessage {
  role: Role;
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

const QWEN_SAMPLING = { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 };

/** Sampling and template flags sent with every chat request. Registry values win over the Qwen fallback. */
export function chatRequestFields(o: { sampling?: Record<string, number>; chatTemplateKwargs?: Record<string, unknown> }): Record<string, unknown> {
  return {
    ...(o.sampling ?? QWEN_SAMPLING),
    chat_template_kwargs: o.chatTemplateKwargs ?? { enable_thinking: false },
  };
}

export interface LlamaClientOptions {
  baseUrl: string;
  apiKey: string;
  sampling?: Record<string, number>;
  chatTemplateKwargs?: Record<string, unknown>;
}

export interface ChatCompletionExtras {
  response_format?: unknown;
  grammar?: string;
  /** Qwen thinking stays off except for planning and hard fixes. */
  enableThinking?: boolean;
  /** Ask llama-server to reuse the KV cache when the prompt prefix matches the previous request. */
  cachePrompt?: boolean;
}

export class LlamaClient {
  constructor(private readonly o: LlamaClientOptions) {}

  private async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const r = await fetch(`${this.o.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
    if (!r.ok) throw new Error(`llama-server ${path}: HTTP ${r.status} ${await r.text()}`);
    return (await r.json()) as T;
  }

  /** Raw /v1/embeddings call (llama-server L2-normalises the full vector). Use embedding.ts `Embedder`,
   *  which adds the EmbeddingGemma 2 prefixes and does Matryoshka truncation + re-normalisation. */
  async embed(texts: string[]): Promise<Float32Array[]> {
    const j = await this.post<{ data: { index: number; embedding: number[] }[] }>('/v1/embeddings', { input: texts, model: 'embed' });
    return j.data.sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding));
  }

  private chatBody(messages: ChatMessage[], tools: readonly unknown[] | undefined, maxTokens: number, stream: boolean, extras?: ChatCompletionExtras) {
    const fields = chatRequestFields(this.o);
    const kwargs = {
      ...(fields.chat_template_kwargs as Record<string, unknown>),
    };
    if (extras?.enableThinking !== undefined) kwargs.enable_thinking = extras.enableThinking;
    return {
      model: 'chat',
      messages,
      ...(tools && tools.length ? { tools } : {}),
      stream,
      max_tokens: maxTokens,
      ...fields,
      chat_template_kwargs: kwargs,
      ...(extras?.response_format ? { response_format: extras.response_format } : {}),
      ...(extras?.grammar ? { grammar: extras.grammar } : {}),
      ...(extras?.cachePrompt ? { cache_prompt: true } : {}),
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
  }

  async chat(messages: ChatMessage[], tools?: readonly unknown[], signal?: AbortSignal, maxTokens = 1024, extras?: ChatCompletionExtras) {
    return this.post<{ choices: { message: ChatMessage; finish_reason: string }[]; usage?: Record<string, number> }>(
      '/v1/chat/completions',
      {
        ...this.chatBody(messages, tools, maxTokens, false, extras),
      },
      signal,
    );
  }

  /** Token stream from llama-server (OpenAI SSE). Tool-call rounds use `chat` / `runWithTools`. */
  async *chatStream(messages: ChatMessage[], tools?: readonly unknown[], signal?: AbortSignal, maxTokens = 1024): AsyncGenerator<string> {
    const r = await fetch(`${this.o.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify(this.chatBody(messages, tools, maxTokens, true)),
      signal,
    });
    if (!r.ok || !r.body) throw new Error(`llama-server /v1/chat/completions: HTTP ${r.status} ${await r.text()}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    const joiner = createStreamJoiner();
    let buf = '';
    const take = (line: string): 'done' | string | null => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return null;
      const data = trimmed.slice(5).trim();
      if (!data) return null;
      if (data === '[DONE]') return 'done';
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const piece = json.choices?.[0]?.delta?.content;
        return piece ? joiner.pushText(piece) : null;
      } catch {
        return null;
      }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const piece = take(line);
        if (piece === 'done') {
          const tail = joiner.flush();
          if (tail) yield tail;
          return;
        }
        if (piece) yield piece;
      }
    }
    buf += decoder.decode();
    if (buf.trim()) {
      const piece = take(buf);
      if (piece && piece !== 'done') yield piece;
    }
    const tail = joiner.flush();
    if (tail) yield tail;
  }

  /**
   * Stream a chat completion, forwarding content deltas, and return the assembled message.
   * Tool-call deltas are collected so the caller still sees native tool_calls.
   */
  async chatCollect(
    messages: ChatMessage[],
    tools: readonly unknown[] | undefined,
    signal: AbortSignal | undefined,
    maxTokens: number,
    extras: ChatCompletionExtras | undefined,
    onDelta: (text: string) => void,
  ): Promise<{ choices: { message: ChatMessage; finish_reason: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
    const r = await fetch(`${this.o.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.o.apiKey}` },
      body: JSON.stringify(this.chatBody(messages, tools, maxTokens, true, extras)),
      signal,
    });
    if (!r.ok || !r.body) throw new Error(`llama-server /v1/chat/completions: HTTP ${r.status} ${await r.text()}`);
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    const joiner = createStreamJoiner();
    let buf = '';
    let content = '';
    let finish = 'stop';
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    const calls = new Map<number, { id: string; name: string; arguments: string }>();
    const take = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const json = JSON.parse(data) as {
          choices?: { finish_reason?: string | null; delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        };
        if (json.usage) usage = json.usage;
        const choice = json.choices?.[0];
        if (choice?.finish_reason) finish = choice.finish_reason;
        const delta = choice?.delta;
        if (delta?.content) {
          const piece = joiner.pushText(delta.content);
          if (piece) {
            content += piece;
            onDelta(piece);
          }
        }
        for (const call of delta?.tool_calls ?? []) {
          const index = call.index ?? 0;
          const row = calls.get(index) ?? { id: '', name: '', arguments: '' };
          if (call.id) row.id = call.id;
          if (call.function?.name) row.name += call.function.name;
          if (call.function?.arguments) row.arguments += call.function.arguments;
          calls.set(index, row);
        }
      } catch { /* partial keepalive */ }
    };
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) take(line);
    }
    buf += decoder.decode();
    if (buf.trim()) take(buf);
    const tail = joiner.flush();
    if (tail) {
      content += tail;
      onDelta(tail);
    }
    const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => ({
      id: call.id || `call-${calls.size}`,
      type: 'function' as const,
      function: { name: call.name, arguments: call.arguments },
    })).filter((call) => call.function.name);
    const message: ChatMessage = {
      role: 'assistant',
      content,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    return { choices: [{ message, finish_reason: finish }], ...(usage ? { usage } : {}) };
  }

  /** Let the model call tools until it produces a final answer (bounded to avoid loops). Content tokens stream as they arrive. */
  async runWithTools(messages: ChatMessage[], tools: readonly unknown[], handlers: Record<string, ToolHandler>,
    maxSteps = 4, signal?: AbortSignal, hooks?: { onDelta?: (text: string) => void; maxTokens?: number; cachePrompt?: boolean }): Promise<{ answer: string; messages: ChatMessage[]; toolCalls: ToolCall[]; finishReason: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
    const msgs = [...messages];
    const used: ToolCall[] = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let sawUsage = false;
    let finishReason = 'stop';
    for (let step = 0; step < maxSteps; step++) {
      const res = await this.chatCollect(msgs, tools, signal, hooks?.maxTokens ?? 1024, hooks?.cachePrompt ? { cachePrompt: true } : undefined, (piece) => hooks?.onDelta?.(piece));
      if (res.usage) {
        sawUsage = true;
        promptTokens += res.usage.prompt_tokens ?? 0;
        completionTokens += res.usage.completion_tokens ?? 0;
      }
      const message = res.choices[0]?.message ?? { role: 'assistant' as const, content: '' };
      finishReason = res.choices[0]?.finish_reason || finishReason;
      msgs.push(message);
      if (!message.tool_calls?.length) {
        return {
          answer: String(message.content ?? ''),
          messages: msgs,
          toolCalls: used,
          finishReason,
          ...(sawUsage ? { usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } } : {}),
        };
      }
      for (const call of message.tool_calls) {
        used.push(call);
        const h = handlers[call.function.name];
        let out: string;
        try {
          const parsed = parseModelJson(call.function.arguments || '{}');
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('tool arguments were not a JSON object');
          out = h ? await h(parsed as Record<string, unknown>) : `error: unknown tool ${call.function.name}`;
        } catch (e) {
          out = `error: ${(e as Error).message}`;
        }
        msgs.push({ role: 'tool', tool_call_id: call.id, content: out });
      }
    }
    return {
      answer: 'Sorry, I could not finish that request.',
      messages: msgs,
      toolCalls: used,
      finishReason,
      ...(sawUsage ? { usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } } : {}),
    };
  }
}

/** Image understanding (Qwen3.5 + mmproj): images are sent as data URLs in the OpenAI format. */
export function imageMessage(question: string, pngOrJpeg: Buffer, mime: 'image/png' | 'image/jpeg'): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: `data:${mime};base64,${pngOrJpeg.toString('base64')}` } },
      { type: 'text', text: question },
    ],
  };
}
