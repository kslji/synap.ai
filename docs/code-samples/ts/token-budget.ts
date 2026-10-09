/**
 * Token budget allocator (main-process orchestrator). Builds every prompt so that it fits a fixed
 * per-request budget, counting tokens with the MODEL'S OWN tokenizer, and logs tokens per part for the
 * developer view. See ARCHITECTURE.md "Token budget".
 *
 * Counting options (all Qwen3.5 sizes share one tokenizer.json):
 *   1) LlamaServerTokenizer  - POST /tokenize on the running llama-server: exact, no extra download.
 *   2) HfTokenizer           - @huggingface/tokenizers (the tokenizer library inside transformers.js)
 *                              with Qwen3.5's tokenizer.json: exact for plain text, works with no server.
 *   3) heuristic             - chars/3.2; last resort. (tiktoken/js-tiktoken are OpenAI vocabularies:
 *                              only approximate for Qwen - do not use them for budgeting.)
 * Chat-template overhead (<|im_start|>role ... <|im_end|>) is a few tokens per message; we add
 * PER_MESSAGE_OVERHEAD, or measure exactly with /apply-template + /tokenize.
 */
import { Tokenizer } from '@huggingface/tokenizers';
import { readFile } from 'node:fs/promises';
import type { ChatMessage } from './llama-client.js';

export interface TokenCounter { count(text: string): Promise<number>; name: string }

export class LlamaServerTokenizer implements TokenCounter {
  name = 'llama-server /tokenize';
  constructor(private baseUrl: string, private apiKey: string) {}
  async count(text: string): Promise<number> {
    const r = await fetch(`${this.baseUrl}/tokenize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ content: text, add_special: false }),
    });
    if (!r.ok) throw new Error(`/tokenize HTTP ${r.status}`);
    return ((await r.json()) as { tokens: unknown[] }).tokens.length;
  }
  /** Exact size of a full chat prompt as the model will see it (template applied by the server). */
  async countChat(messages: ChatMessage[]): Promise<number> {
    const r = await fetch(`${this.baseUrl}/apply-template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ messages, chat_template_kwargs: { enable_thinking: false } }),
    });
    if (!r.ok) throw new Error(`/apply-template HTTP ${r.status}`);
    return this.count(((await r.json()) as { prompt: string }).prompt);
  }
}

export class HfTokenizer implements TokenCounter {
  name = '@huggingface/tokenizers';
  private constructor(private tok: Tokenizer) {}
  /** dir contains tokenizer.json + tokenizer_config.json from huggingface.co/Qwen/Qwen3.5-4B (13 MB). */
  static async load(dir: string): Promise<HfTokenizer> {
    const [json, cfg] = await Promise.all([readFile(`${dir}/tokenizer.json`, 'utf8'), readFile(`${dir}/tokenizer_config.json`, 'utf8')]);
    return new HfTokenizer(new Tokenizer(JSON.parse(json), JSON.parse(cfg)));
  }
  async count(text: string): Promise<number> { return this.tok.encode(text, { add_special_tokens: false }).ids.length; }
}

export const heuristicCounter: TokenCounter = { name: 'heuristic chars/3.2', count: async (t) => Math.ceil(t.length / 3.2) };

export const PER_MESSAGE_OVERHEAD = 5; // "<|im_start|>user\n" + "<|im_end|>\n" (Qwen ChatML)
export const ASSISTANT_PREFIX = 7; //     "<|im_start|>assistant\n<think>\n\n</think>\n\n" with thinking off [measured 2026-10-09]

/** Per-request budgets. `total` = prompt + answer for ONE request; llama-server -c is larger (tool loops). */
export interface BudgetProfile {
  total: number; systemAndTools: number; retrieved: number; history: number; question: number; answerMin: number;
  maxChunks: number; keepTurns: number; serverCtx: number;
}
export const BUDGETS: Record<'tier0' | 'tier1' | 'tier2', BudgetProfile> = {
  // tier 0 (<8 GB, Qwen3.5-2B) and tier 1 (8 GB, Qwen3.5-4B): 4K per request, server -c 8192
  tier0: { total: 4096, systemAndTools: 400, retrieved: 1500, history: 1000, question: 300, answerMin: 800, maxChunks: 4, keepTurns: 3, serverCtx: 8192 },
  tier1: { total: 4096, systemAndTools: 400, retrieved: 1500, history: 1000, question: 300, answerMin: 800, maxChunks: 4, keepTurns: 3, serverCtx: 8192 },
  // tier 2+ (16 GB+, Qwen3.5-9B): 8K per request, server -c 16384
  tier2: { total: 8192, systemAndTools: 700, retrieved: 3000, history: 2200, question: 800, answerMin: 1500, maxChunks: 5, keepTurns: 4, serverCtx: 16384 },
};

export interface Chunk { id: string; text: string; title: string; score: number }
export interface Turn { user: string; assistant: string }
export interface BudgetInput {
  system: string; //                  keep byte-identical across requests -> llama-server reuses its KV cache (cache_prompt)
  tools?: readonly unknown[]; //      include ONLY when the router decided tools may be needed
  chunks: Chunk[]; //                 already reranked, deduped and above the relevance threshold
  history: Turn[]; //                 oldest first
  historySummary?: string; //         rolling summary of turns older than keepTurns (made by a background job)
  question: string;
}
export interface BudgetReport {
  counter: string; total: number; parts: Record<'system' | 'tools' | 'retrieved' | 'summary' | 'history' | 'question' | 'answerReserve', number>;
  droppedChunks: number; droppedTurns: number; truncatedQuestion: boolean;
}

/** Cut text to at most `max` tokens (binary search on characters; counts with the real tokenizer). */
export async function truncateToTokens(c: TokenCounter, text: string, max: number, marker = ' […]'): Promise<string> {
  if ((await c.count(text)) <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((await c.count(text.slice(0, mid) + marker)) <= max) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + marker;
}

export async function allocate(c: TokenCounter, p: BudgetProfile, input: BudgetInput):
  Promise<{ messages: ChatMessage[]; tools?: readonly unknown[]; maxTokens: number; report: BudgetReport }> {
  const n = async (t: string) => (await c.count(t)) + PER_MESSAGE_OVERHEAD;
  const parts: BudgetReport['parts'] = { system: 0, tools: 0, retrieved: 0, summary: 0, history: 0, question: 0, answerReserve: 0 };

  // 1) fixed parts. The system prompt is NOT trimmed (stable prefix = cache hits); if it is over budget that is a bug.
  parts.system = (await n(input.system)) + ASSISTANT_PREFIX;
  parts.tools = input.tools?.length ? await c.count(JSON.stringify(input.tools)) : 0;
  if (parts.system + parts.tools > p.systemAndTools * 1.5) throw new Error(`system+tools ${parts.system + parts.tools} tokens: shorten them`);

  // 2) question: hard cap. Long pastes/attachments must go through retrieval (chunks), never inline.
  let question = input.question;
  const qCap = p.question * 2; // a long question may borrow from the answer reserve, up to 2x
  const truncatedQuestion = (await c.count(question)) > qCap;
  if (truncatedQuestion) question = await truncateToTokens(c, question, qCap);
  parts.question = await n(question);

  // 3) retrieved chunks: best first, whole chunks only, stop at budget or maxChunks
  const sources: string[] = [];
  let used = 0, droppedChunks = 0;
  for (const ch of input.chunks) {
    const block = `[S${sources.length + 1}] ${ch.title}\n${ch.text}`;
    const t = await c.count(block);
    if (sources.length >= p.maxChunks || used + t > p.retrieved) { droppedChunks++; continue; }
    sources.push(block); used += t;
  }
  parts.retrieved = sources.length ? used + PER_MESSAGE_OVERHEAD : 0;

  // 4) history: newest turns first, up to keepTurns, within budget; older turns are represented by the summary
  const histMsgs: ChatMessage[] = [];
  let hUsed = 0, droppedTurns = 0, summaryText = '';
  if (input.historySummary) {
    const s = await truncateToTokens(c, input.historySummary, Math.floor(p.history * 0.25));
    parts.summary = await n(s);
    hUsed += parts.summary;
    summaryText = `\n\nSummary of the earlier conversation: ${s}`;
  }
  const recent: ChatMessage[] = [];
  const turns = [...input.history].reverse();
  for (let i = 0; i < turns.length; i++) {
    const t = (await n(turns[i].user)) + (await n(turns[i].assistant));
    if (i >= p.keepTurns || hUsed + t > p.history) { droppedTurns = turns.length - i; break; }
    recent.unshift({ role: 'user', content: turns[i].user }, { role: 'assistant', content: turns[i].assistant });
    hUsed += t;
  }
  histMsgs.push(...recent);
  parts.history = hUsed - parts.summary;

  // 5) whatever is left goes to the answer (at least answerMin)
  const promptTokens = parts.system + parts.tools + parts.retrieved + parts.summary + parts.history + parts.question;
  const maxTokens = p.total - promptTokens;
  if (maxTokens < p.answerMin) throw new Error(`budget overflow: only ${maxTokens} tokens left for the answer`);
  parts.answerReserve = maxTokens;

  // Order matters for caching: [stable system][summary] [history] [sources + question].
  // Qwen3.5's chat template allows ONE system message, at the start (a second one raises a template
  // error), so the summary is appended to it; the unchanged system text stays a cacheable prefix.
  const user = sources.length
    ? `SOURCES:\n${sources.join('\n\n')}\n\nAnswer using only the sources above and cite them like [S1]. Question: ${question}`
    : question;
  const messages: ChatMessage[] = [{ role: 'system', content: input.system + summaryText }, ...histMsgs, { role: 'user', content: user }];
  return {
    messages, tools: input.tools?.length ? input.tools : undefined, maxTokens,
    report: { counter: c.name, total: promptTokens + maxTokens, parts, droppedChunks, droppedTurns, truncatedQuestion },
  };
}

/** Developer view: one line per request (written to the dev log and shown in Settings -> Developer). */
export const formatReport = (r: BudgetReport) =>
  `[budget ${r.counter}] ` + Object.entries(r.parts).map(([k, v]) => `${k}=${v}`).join(' ') +
  ` total=${r.total} dropped(chunks=${r.droppedChunks}, turns=${r.droppedTurns})${r.truncatedQuestion ? ' question-truncated' : ''}`;
