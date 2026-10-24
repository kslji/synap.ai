/**
 * Embeddings for code chunks.
 * Production uses Jina code embeddings through the existing Embedder (prefixes, 256-d, L2).
 * Tests use a deterministic hashed bag-of-tokens so ranking does not need the model.
 */
import { EMBEDDING_DIM } from './embed-dim.js'
import type { Embedder } from '../embedding.js'

export interface CodeEmbedder {
  dim: number
  embedDocs(docs: { title?: string | null; text: string }[]): Promise<Float32Array[]>
  embedQueries(queries: string[]): Promise<Float32Array[]>
}

export function hashEmbed(text: string, dim = EMBEDDING_DIM): Float32Array {
  const out = new Float32Array(dim)
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? []
  for (const token of tokens) {
    let hash = 2166136261
    for (let i = 0; i < token.length; i++) hash = Math.imul(hash ^ token.charCodeAt(i), 16777619)
    const bucket = (hash >>> 0) % dim
    const sign = ((hash >>> 8) & 1) === 0 ? 1 : -1
    out[bucket] += sign * (1 + Math.min(token.length, 12) / 12)
  }
  let norm = 0
  for (let i = 0; i < dim; i++) norm += out[i] * out[i]
  norm = Math.sqrt(norm)
  if (norm === 0) { out[0] = 1; return out }
  for (let i = 0; i < dim; i++) out[i] /= norm
  return out
}

export function hashEmbedder(dim = EMBEDDING_DIM): CodeEmbedder {
  return {
    dim,
    embedDocs: async (docs) => docs.map((doc) => hashEmbed(`${doc.title ?? ''}\n${doc.text}`, dim)),
    embedQueries: async (queries) => queries.map((query) => hashEmbed(query, dim)),
  }
}

/** Adapter: the app's Jina code embeddings client already applies the model-card prefixes. */
export function gemmaEmbedder(embedder: Embedder): CodeEmbedder {
  return {
    dim: embedder.spec.dim,
    embedDocs: (docs) => embedder.embedDocs(docs),
    embedQueries: (queries) => embedder.embedQueries(queries),
  }
}

export function vectorBytes(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength)
}
