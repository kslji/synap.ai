/**
 * Which chat and embedding files a tier would use.
 * This only names the files. Every tier uses the same chat file (Qwen3.5 4B Q4_K_M)
 * and the same Jina code embeddings file.
 */
import { pick, type ModelEntry, type ModelRegistry } from './model-registry.js'

export interface FirstLaunchPlan {
  chat: ModelEntry
  embed: ModelEntry
  skip: boolean
}

export function firstLaunchPlan(opts: {
  tier: number
  registry: ModelRegistry
  installed: (id: string) => boolean
}): FirstLaunchPlan {
  const chat = pick(opts.registry, 'chat', opts.tier)
  const embed = pick(opts.registry, 'embedding', opts.tier)
  return { chat, embed, skip: opts.installed(chat.id) && opts.installed(embed.id) }
}
