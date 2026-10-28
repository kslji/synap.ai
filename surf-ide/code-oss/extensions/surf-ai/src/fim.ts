/**
 * Fill-in-the-middle completion for Tab ghost text.
 *
 * The local sidecar serves the Qwen-family models whose chat template speaks
 * the ChatML FIM protocol: a `user` turn wrapped in the special im_start /
 * im_end markers, with the special "middle" token splitting prefix and suffix.
 * Building that string here (pure, no vscode) keeps the prompt format unit-
 * testable and shared by every caller.
 */

const IM_START = '<|' + 'im_start|>';
const IM_END = '<|' + 'im_end|>';
const IM_MIDDLE = '<|' + 'im_middle|>';

/** The three stop tokens a FIM turn must break on. */
export const FIM_STOP_TOKENS = ['\n\n', IM_END, IM_MIDDLE];

/** Hard headroom so one keystroke never streams a paragraph. */
export const FIM_MAX_TOKENS = 96;

/** Cap on context windows sent with the request (~4k chars each side). */
export const FIM_MAX_CONTEXT = 4000;

export interface FimRequest {
  /** Text before the cursor. */
  prefix: string;
  /** Text after the cursor. */
  suffix: string;
}

/** Build the ChatML FIM prompt: system instruction, prefix, middle, suffix. */
export function buildFimPrompt({ prefix, suffix }: FimRequest): string {
  const p = prefix.slice(-FIM_MAX_CONTEXT);
  const s = suffix.slice(0, FIM_MAX_CONTEXT);
  return IM_START + 'system\nYou are a code completion assistant. Output ONLY the code'
    + ' that belongs at the cursor, with no explanations, fences, or commentary.' + IM_END + '\n'
    + IM_START + 'user\n' + p + IM_MIDDLE + s + IM_END + '\n'
    + IM_START + 'assistant\n';
}

/** Trim a raw completion: drop anything past a stop token and surrounding blanks. */
export function sanitizeFimCompletion(text: string): string {
  let out = text;
  for (const stop of FIM_STOP_TOKENS) {
    const at = out.indexOf(stop);
    if (at !== -1) {
      out = out.slice(0, at);
    }
  }
  return out.trim();
}

/**
 * Small fixed-capacity LRU keyed by the FIM request. A cache hit means the
 * keystroke pattern repeated (re-opening a file, double blank line), and ghost
 * text can render without spending a model call.
 */
export class LruCache<K, V> {
  constructor(private readonly capacity: number) {}

  private readonly map = new Map<K, V>();

  get(key: K): V | undefined {
    if (!this.map.has(key)) {
      return undefined;
    }
    // Re-insert to mark the entry as most recently used.
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value as K;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

/** Stable cache key: document + position + the immediate context. */
export function fimCacheKey(docUri: string, line: number, character: number, req: FimRequest): string {
  return docUri + ':' + line + ':' + character + ':' + req.prefix.slice(-80) + ':' + req.suffix.slice(0, 40);
}
