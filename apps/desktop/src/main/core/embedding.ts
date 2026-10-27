/**
 * Embedding spec + client for Jina embeddings v2 base code (code-aware, 768-d) served by
 * llama-server. It replaces the text-only search model: 121 MB instead of 295 MB, and its
 * training set is code, so a symbol name and a doc comment land closer together than they
 * did on a text model.
 *
 * The SAME spec is used by the server pipeline (docs/code-samples/embedding_spec.py) and the
 * desktop. A pack built with a different spec is refused (pack-verify.ts), because vectors from
 * different models / dimensions / prefixes are not comparable. Changing the spec = re-index
 * everything.
 *
 * Rules from the model card (jinaai/jina-embeddings-v2-base-code):
 *  - no task prefixes: a query and a document are embedded as they are
 *  - documents: "{title}\n{text}", and a document with no title is just its text
 *  - Matryoshka: keep the first 256 of 768 dims, then RE-NORMALISE (L2) - slicing breaks unit length
 *  - mean pooling (llama-server --pooling mean). Bidirectional attention: -ub must be >= longest input.
 *  - a NaN/zero vector means the weights or the build are wrong, so it is rejected here
 */
import type { LlamaClient } from './llama-client.js';

export interface EmbeddingSpec {
  /** Compatibility key stored in pack manifests and user.db. */
  id: string;
  model: string;          // HF repo of the original weights
  gguf: string;           // file the desktop runs (Q5_K_M); pipeline must use the same file or the same weights
  nativeDim: number;
  dim: number;            // stored dimension (Matryoshka truncation)
  pooling: 'mean';
  normalize: true;
  queryPrefix: string;
  docTemplate: string;    // {title} and {text} placeholders
  maxTokens: number;      // longest input we send (chunks are far shorter)
}

export const JINA_CODE_256: EmbeddingSpec = {
  id: 'jina-embeddings-v2-base-code@256',
  model: 'jinaai/jina-embeddings-v2-base-code',
  gguf: 'jina-embeddings-v2-base-code-Q5_K_M.gguf',
  nativeDim: 768,
  dim: 256,
  pooling: 'mean',
  normalize: true,
  queryPrefix: '',
  docTemplate: '{title}\n{text}',
  maxTokens: 2048,
};

/** The fields that must match exactly between a pack and the app. */
export function specKey(s: Pick<EmbeddingSpec, 'id' | 'dim' | 'pooling' | 'queryPrefix' | 'docTemplate'>): string {
  return JSON.stringify([s.id, s.dim, s.pooling, s.queryPrefix, s.docTemplate]);
}

export const formatQuery = (s: EmbeddingSpec, q: string) => s.queryPrefix + q.trim();

/** "{title}\n{text}", with the title line dropped entirely when there is no title. */
export const formatDoc = (s: EmbeddingSpec, title: string | null | undefined, text: string): string => {
  const head = title?.trim() ? title.trim().replace(/\s+/g, ' ') : '';
  const doc = s.docTemplate.replace('{title}', head).replace('{text}', text.trim());
  return head ? doc : doc.replace(/^\n+/, '');
};

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
  constructor(private readonly client: LlamaClient, readonly spec: EmbeddingSpec = JINA_CODE_256, private readonly batch = 32) {}

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
