export const product = {
  name: 'Surf AI',
  tagline: "Works offline. Stays up to date when you're online.",
  appId: 'ai.surf.desktop',
  repo: 'https://github.com/kslji/synap.ai',
  releasesUrl: 'https://github.com/kslji/synap.ai/releases/latest',
} as const

export const modelTiers = [
  { ram: 'Under 8 GB', chat: 'Qwen3.5 2B', quant: 'Q4_K_M', note: 'Fallback when memory is tight' },
  { ram: '8 GB', chat: 'Qwen3.5 4B', quant: 'Q4_K_M', note: 'The usual laptop' },
  { ram: '16 GB and above', chat: 'Qwen3.5 9B', quant: 'Q4_K_M', note: 'Best quality on this build' },
] as const

export const embeddingModel = {
  name: 'EmbeddingGemma 2',
  detail: 'Text only, 256 dimensions, with task prefixes',
} as const

export interface PackManifestShape {
  format: 'surf-pack/1' | 'harbor-pack/1'
  pack_id: string
  niche: string
  version: string
}
