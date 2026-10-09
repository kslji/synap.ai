/**
 * Minimal client for llama-server's OpenAI-compatible API (main process) + the tool-calling loop.
 * Qwen3.5 thinks by default; for snappy chat on laptops we turn thinking OFF per request with
 * chat_template_kwargs.enable_thinking=false and use Qwen's recommended non-thinking sampling.
 */
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

export interface LlamaClientOptions {
  baseUrl: string;
  apiKey: string;
  sampling?: Record<string, number>;
  chatTemplateKwargs?: Record<string, unknown>;
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

  async chat(messages: ChatMessage[], tools?: readonly unknown[], signal?: AbortSignal, maxTokens = 1024) {
    return this.post<{ choices: { message: ChatMessage; finish_reason: string }[]; usage?: Record<string, number> }>(
      '/v1/chat/completions',
      {
        model: 'chat',
        messages,
        tools,
        max_tokens: maxTokens,
        ...(this.o.sampling ?? { temperature: 0.7, top_p: 0.8, top_k: 20, presence_penalty: 1.5 }),
        chat_template_kwargs: this.o.chatTemplateKwargs ?? { enable_thinking: false },
      },
      signal,
    );
  }

  /** Let the model call tools until it produces a final answer (bounded to avoid loops). */
  async runWithTools(messages: ChatMessage[], tools: readonly unknown[], handlers: Record<string, ToolHandler>,
    maxSteps = 4, signal?: AbortSignal): Promise<{ answer: string; messages: ChatMessage[]; toolCalls: ToolCall[] }> {
    const msgs = [...messages];
    const used: ToolCall[] = [];
    for (let step = 0; step < maxSteps; step++) {
      const { message } = (await this.chat(msgs, tools, signal)).choices[0];
      msgs.push(message);
      if (!message.tool_calls?.length) return { answer: String(message.content ?? ''), messages: msgs, toolCalls: used };
      for (const call of message.tool_calls) {
        used.push(call);
        const h = handlers[call.function.name];
        let out: string;
        try {
          out = h ? await h(JSON.parse(call.function.arguments || '{}')) : `error: unknown tool ${call.function.name}`;
        } catch (e) {
          out = `error: ${(e as Error).message}`;
        }
        msgs.push({ role: 'tool', tool_call_id: call.id, content: out });
      }
    }
    return { answer: 'Sorry, I could not finish that request.', messages: msgs, toolCalls: used };
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
