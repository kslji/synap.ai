export const product = {
  name: 'Synap.surf',
  tagline: "Works offline. Stays up to date when you're online.",
  appId: 'ai.surf.desktop',
  repo: 'https://github.com/kslji/synap.ai',
  releasesUrl: 'https://github.com/kslji/synap.ai/releases/latest',
  site: 'https://synap.surf',
} as const

/** One chat model for every laptop (8 GB minimum) and every agent, with an optional larger one. See docs/adr/0007-qwen35-2b-default.md. */
export const modelTiers = [
  { ram: '8 GB and above', chat: 'Qwen 2B', quant: 'Q4_K_M', note: 'The default for every laptop and every agent' },
  { ram: '8 GB and above', chat: 'Qwen 4B', quant: 'Q4_K_M', note: 'Optional, more accurate download' },
] as const

export const embeddingModel = {
  name: 'Jina code embeddings',
  detail: 'Code-aware, 256 dimensions, no prefixes',
} as const

export interface PackManifestShape {
  format: 'surf-pack/1' | 'harbor-pack/1'
  pack_id: string
  niche: string
  version: string
}

// The agent list is loaded through a bundler-only `import.meta.glob`, so it lives in
// `./agent-catalog` and is imported directly by the Vite apps. Re-exporting it here would
// force that call to run for every Node consumer of `@surf/shared` (tests, scripts) and throw.
export { agentCanChat, agentCanOpen, parseAgentFile, sortAgents, type AgentMeta, type AgentStatus } from './agents'
