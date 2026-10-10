/**
 * What the first launch downloads. The chat model follows the RAM tier.
 * EmbeddingGemma 2 is the same file on every tier. If both are already on disk, skip the download.
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
