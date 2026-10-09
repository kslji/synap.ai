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
  tiers: z.array(z.number().int().min(0).max(3)),
  chat_template_kwargs: z.record(z.string(), z.unknown()).optional(),
  sampling: z.record(z.string(), z.number()).optional(),
});
export type ModelEntry = z.infer<typeof ModelEntry>;

export const ModelRegistry = z.object({
  registry_format: z.literal('harbor-models/1'),
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

export function pick(reg: ModelRegistry, role: ModelEntry['role'], tier: number): ModelEntry {
  const candidates = reg.models.filter((m) => m.role === role && m.tiers.includes(tier));
  if (candidates.length === 0) throw new Error(`no ${role} model for tier ${tier}`);
  // largest model that fits the tier wins
  return candidates.sort((a, b) => (b.params_b ?? 0) - (a.params_b ?? 0))[0];
}
