/**
 * Model registry ("model upgrade path"): which GGUF files exist, where to download them, their exact
 * size + SHA-256, and which hardware tier they fit. The app ships a default copy and refreshes a signed
 * copy from our API when online, so a newer model (e.g. a future Qwen release) can be adopted by
 * publishing a new registry entry - no app update needed, as long as llama.cpp supports the architecture.
 */
import { z } from 'zod';

const FileRef = z.object({
  file: z.string(),
  url: z.string().url(),
  size_bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const ModelEntry = FileRef.extend({
  id: z.string(),
  role: z.enum(['chat', 'embedding', 'asr', 'vad']),
  family: z.string(),
  license: z.string(),
  params_b: z.number().optional(),
  context_default: z.number().int().optional(),
  context_max: z.number().int().optional(),
  dim: z.number().int().optional(),
  pooling: z.string().optional(),
  native_dim: z.number().int().optional(),
  query_prefix: z.string().optional(),
  doc_template: z.string().optional(),
  spec_id: z.string().optional(), // embedding compatibility key (embedding.ts)
  min_llama_cpp_build: z.number().int().optional(), // e.g. 11452 = first llama.cpp release with gemma-embedding2
  mmproj: FileRef.optional(),
  min_ram_gb: z.number(),
  /** Measured process peak, when we have one. */
  peak_ram_gb: z.number().positive().optional(),
  ram_measured: z.boolean().optional(),
  tiers: z.array(z.number().int().min(0).max(3)),
  /** When set, only these agents may use the file. Omitted entries serve every agent. */
  agents: z.array(z.string()).optional(),
  /** Agents that auto-select this file when the user has not picked. */
  default_for: z.array(z.string()).optional(),
  /** Short name when family + size is not the label to show. */
  label: z.string().optional(),
  /** Size token in the Code picker, such as E2B. Omitted rows use params_b. */
  size_name: z.string().optional(),
  note: z.string().optional(),
  chat_template_kwargs: z.record(z.string(), z.unknown()).optional(),
  sampling: z.record(z.string(), z.number()).optional(),
});
export type ModelEntry = z.infer<typeof ModelEntry>;

export const ModelRegistry = z.object({
  registry_format: z.literal('surf-models/1'),
  updated_at: z.string(),
  models: z.array(ModelEntry),
});
export type ModelRegistry = z.infer<typeof ModelRegistry>;

/** Licences we allow to be auto-downloaded. Anything else needs an explicit product decision. */
export const ALLOWED_LICENSES = new Set(['apache-2.0', 'mit']);

export function parseRegistry(json: unknown): ModelRegistry {
  const reg = ModelRegistry.parse(json);
  for (const m of reg.models) {
    if (!ALLOWED_LICENSES.has(m.license)) throw new Error(`model ${m.id}: licence ${m.license} not allowed`);
  }
  return reg;
}

/** Rows with `agents` (such as the draft) serve only those agents. Every other chat row serves every agent. */
export function servesAgent(model: { agents?: string[] }, agentId: string): boolean {
  if (model.agents && model.agents.length > 0) return model.agents.includes(agentId);
  return true;
}

/** Local name for an mmproj file. Several models ship `mmproj-F16.gguf` with different bytes. */
export function mmprojDestName(modelId: string, mmprojFile: string): string {
  return `${modelId}--${mmprojFile}`;
}

export function pick(reg: ModelRegistry, role: ModelEntry['role'], tier: number, agentId = 'general'): ModelEntry {
  const candidates = reg.models.filter((m) => m.role === role && m.tiers.includes(tier) && (role !== 'chat' || servesAgent(m, agentId)));
  if (candidates.length === 0) throw new Error(`no ${role} model for tier ${tier}`);
  // largest model that fits the tier wins
  return candidates.sort((a, b) => (b.params_b ?? 0) - (a.params_b ?? 0))[0];
}

/** Smallest model marked as the default for an agent. Code uses this when the user has not picked. */
export function defaultForAgent(reg: ModelRegistry, agentId: string): ModelEntry | null {
  const marked = reg.models.filter((m) => m.role === 'chat' && servesAgent(m, agentId) && m.default_for?.includes(agentId));
  if (!marked.length) return null;
  return [...marked].sort((a, b) => (a.params_b ?? 0) - (b.params_b ?? 0) || a.min_ram_gb - b.min_ram_gb)[0];
}

/** Next smaller chat model in the same family, then the next smaller Qwen. */
export function smallerChatModel(models: readonly ModelEntry[], currentId: string): ModelEntry | null {
  const current = models.find((m) => m.id === currentId);
  if (!current) return null;
  const rank = (m: ModelEntry) => m.min_ram_gb * 1000 + (m.params_b ?? 0);
  const smaller = models.filter((m) => {
    if (m.id === current.id || m.role !== 'chat') return false;
    if (m.min_ram_gb < current.min_ram_gb) return true;
    return m.min_ram_gb === current.min_ram_gb && (m.params_b ?? 0) < (current.params_b ?? 0);
  });
  const same = smaller.filter((m) => m.family === current.family).sort((a, b) => rank(b) - rank(a));
  if (same[0]) return same[0];
  const qwen = smaller.filter((m) => m.family === 'qwen3.5').sort((a, b) => rank(b) - rank(a));
  return qwen[0] ?? null;
}
