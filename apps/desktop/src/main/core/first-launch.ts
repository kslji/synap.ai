/**
 * Which chat and embedding files a tier would use.
 * This only names the files. The first open downloads the Q4 chat file the installer asked for.
 * EmbeddingGemma 2 is the same file on every tier.
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
