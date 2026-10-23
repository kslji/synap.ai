/**
 * Which chat model a plain `npm run bench:offline` measures.
 *
 * The app ships Qwen3.5-2B as the default for every tier, and the bench has to measure what a
 * person actually gets on first launch: the row marked `default_for: ["*"]`. Picking the largest
 * file that happens to fit (the old rule) measured a model nobody starts with. `--model` and
 * `--model-file` still win over all of this.
 */

export interface ChatRow {
  id: string
  file: string
  size_bytes?: number
  min_ram_gb?: number
  tiers?: number[]
  context_default?: number
  draft?: { id: string; file: string }
  default_for?: string[]
}

/** Chat rows only: a loadable .gguf with a context size, never a draft or embedding model. */
export function chatRows<T extends ChatRow>(models: T[]): T[] {
  return models.filter((m) => (m.file ?? '').endsWith('.gguf') && !m.draft && m.context_default)
}

export function pickChatModel<T extends ChatRow>(models: T[], args: { model?: string }, ramGb: number, tier: number): T | undefined {
  const chats = chatRows(models);
  if (args.model) return chats.find((m) => m.id === args.model);
  const marked = chats.find((m) => m.default_for?.includes('*'));
  if (marked) return marked;
  // Nothing marked: the largest file the machine can hold, else the smallest there is.
  const fits = chats
    .filter((m) => (m.min_ram_gb ?? 0) <= ramGb && (m.tiers ?? []).includes(tier))
    .sort((a, b) => (b.size_bytes ?? 0) - (a.size_bytes ?? 0));
  return fits[0] ?? chats.sort((a, b) => (a.size_bytes ?? 0) - (b.size_bytes ?? 0))[0];
}
