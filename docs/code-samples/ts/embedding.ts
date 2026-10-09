/**
 * Embedding spec + client for EmbeddingGemma 2 (text-only, 270M backbone) served by llama-server.
 *
 * The SAME spec is used by the server pipeline (code-samples/embedding_spec.py) and the desktop.
 * A pack built with a different spec is refused (pack-verify.ts), because vectors from different
 * models / dimensions / prefixes are not comparable. Changing the spec = re-index everything.
 *
 * Rules from the model card (google/embeddinggemma-2):
 *  - queries:   "task: search result | query: {query}"
 *  - documents: "title: {title} | text: {content}"   (title: none when there is no title)
 *  - Matryoshka: keep the first 256 of 768 dims, then RE-NORMALISE (L2) - slicing breaks unit length.
 *  - bfloat16 / float32 only; float16 gives NaN or silently degraded vectors -> we reject NaN here.
 *  - mean pooling (llama-server --pooling mean). Bidirectional attention: -ub must be >= longest input.
 */
import type { LlamaClient } from './llama-client.js';

export interface EmbeddingSpec {
  /** Compatibility key stored in pack manifests and user.db. */
  id: string;
  model: string;          // HF repo of the original weights
  gguf: string;           // file the desktop runs (Q8_0); pipeline must use the same file or the same weights
  nativeDim: number;
  dim: number;            // stored dimension (Matryoshka truncation)
  pooling: 'mean';
  normalize: true;
  queryPrefix: string;
  docTemplate: string;    // {title} and {text} placeholders
  maxTokens: number;      // longest input we send (chunks are far shorter)
}

export const EMBEDDINGGEMMA2_256: EmbeddingSpec = {
  id: 'embeddinggemma-2-text@256',
  model: 'google/embeddinggemma-2',
  gguf: 'embeddinggemma-2-Q8_0.gguf',
  nativeDim: 768,
  dim: 256,
  pooling: 'mean',
  normalize: true,
  queryPrefix: 'task: search result | query: ',
  docTemplate: 'title: {title} | text: {text}',
  maxTokens: 2048,
};

/** The fields that must match exactly between a pack and the app. */
export function specKey(s: Pick<EmbeddingSpec, 'id' | 'dim' | 'pooling' | 'queryPrefix' | 'docTemplate'>): string {
  return JSON.stringify([s.id, s.dim, s.pooling, s.queryPrefix, s.docTemplate]);
}

export const formatQuery = (s: EmbeddingSpec, q: string) => s.queryPrefix + q.trim();
export const formatDoc = (s: EmbeddingSpec, title: string | null | undefined, text: string) =>
  s.docTemplate.replace('{title}', title?.trim() ? title.trim().replace(/\s+/g, ' ') : 'none').replace('{text}', text.trim());

/** Matryoshka truncation + L2 re-normalisation. Throws on NaN/zero vectors (float16 symptom). */
export function truncateNormalize(v: ArrayLike<number>, dim: number): Float32Array {
  if (v.length < dim) throw new Error(`embedding has ${v.length} dims, need ${dim}`);
  const out = new Float32Array(dim);
  let n = 0;
  for (let i = 0; i < dim; i++) { const x = v[i]; if (!Number.isFinite(x)) throw new Error('embedding contains NaN/Inf (float16 weights?)'); out[i] = x; n += x * x; }
  n = Math.sqrt(n);
  if (n === 0) throw new Error('zero embedding');
  for (let i = 0; i < dim; i++) out[i] /= n;
  return out;
}

/** Thin wrapper that always applies prefixes, truncation and normalisation the same way. */
export class Embedder {
  constructor(private readonly client: LlamaClient, readonly spec: EmbeddingSpec = EMBEDDINGGEMMA2_256, private readonly batch = 32) {}

  private async run(inputs: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < inputs.length; i += this.batch) {
      const raw = await this.client.embed(inputs.slice(i, i + this.batch));
      for (const v of raw) {
        if (v.length !== this.spec.nativeDim) throw new Error(`model returned ${v.length} dims, spec says ${this.spec.nativeDim}`);
        out.push(truncateNormalize(v, this.spec.dim));
      }
    }
    return out;
  }

  embedQueries(queries: string[]) { return this.run(queries.map((q) => formatQuery(this.spec, q))); }
  embedDocs(docs: { title?: string | null; text: string }[]) { return this.run(docs.map((d) => formatDoc(this.spec, d.title, d.text))); }
}
