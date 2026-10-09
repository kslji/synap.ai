/**
 * Hybrid retrieval + relevance gate (main process). Port of code-samples/hybrid_search.py.
 *   1) keyword search: FTS5 bm25            2) vector search: sqlite-vec (cosine)
 *   3) merge with Reciprocal Rank Fusion    4) gate: answer | borderline | insufficient
 * "insufficient" => web search if online + allowed by the user/agent, otherwise a polite refusal.
 * Thresholds come from the agent manifest and MUST be calibrated per embedding model on a golden set.
 */
import type { DB } from './db.js';

export const RRF_K = 60;

export interface Hit {
  pack: string; chunkId: number; text: string; title: string; url: string;
  cosine: number; bm25Rank: number | null; vecRank: number | null; rrf: number;
}
export type GateDecision = 'answer' | 'borderline' | 'insufficient';

const words = (s: string, minLen: number) => (s.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []).filter((t) => t.length >= minLen);

/** Free text -> safe FTS5 OR-query of quoted terms (prevents FTS5 syntax errors / injection). */
export function ftsQuery(q: string): string {
  const terms = words(q, 3).slice(0, 16).map((t) => `"${t.replace(/"/g, '')}"`);
  return terms.length ? terms.join(' OR ') : '""';
}

export function searchPack(name: string, db: DB, query: string, qvec: Float32Array, k = 30): Hit[] {
  const hits = new Map<number, Hit>();
  const get = (id: number): Hit => {
    let h = hits.get(id);
    if (!h) { h = { pack: name, chunkId: id, text: '', title: '', url: '', cosine: 0, bm25Rank: null, vecRank: null, rrf: 0 }; hits.set(id, h); }
    return h;
  };
  const fts = db.prepare('SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?')
    .all(ftsQuery(query), k) as { id: number }[];
  fts.forEach((r, i) => { get(r.id).bm25Rank = i; });
  const vec = db.prepare('SELECT chunk_id AS id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ?')
    .all(Buffer.from(qvec.buffer, qvec.byteOffset, qvec.byteLength), k) as { id: number; distance: number }[];
  vec.forEach((r, i) => { const h = get(r.id); h.vecRank = i; h.cosine = 1 - r.distance; });
  const row = db.prepare('SELECT c.text, d.title, d.url FROM chunks c JOIN documents d ON d.id = c.doc_id WHERE c.id = ?');
  for (const h of hits.values()) {
    h.rrf = [h.bm25Rank, h.vecRank].reduce<number>((s, r) => (r === null ? s : s + 1 / (RRF_K + r + 1)), 0);
    const r = row.get(h.chunkId) as { text: string; title: string | null; url: string | null };
    h.text = r.text; h.title = r.title ?? ''; h.url = r.url ?? '';
  }
  return [...hits.values()];
}

export function termCoverage(query: string, hits: Hit[]): number {
  const terms = new Set(words(query, 4));
  if (!terms.size) return 0;
  const blob = hits.map((h) => h.text.toLowerCase()).join(' ');
  return [...terms].filter((t) => blob.includes(t)).length / terms.size;
}

/** Defaults are placeholders for EmbeddingGemma 2 @256 (unrelated text ~0.5, relevant ~0.85 in our tests);
 *  calibrate on the golden set. Non-English queries get low keyword coverage -> 'borderline' -> LLM check. */
export function gate(query: string, hits: Hit[], tauCos = 0.7, tauCov = 0.5): GateDecision {
  if (!hits.length) return 'insufficient';
  const best = Math.max(...hits.map((h) => h.cosine));
  const cov = termCoverage(query, hits.slice(0, 5));
  if (best >= tauCos && cov >= tauCov) return 'answer';
  if (best >= tauCos - 0.08 || cov >= tauCov) return 'borderline'; // -> short yes/no LLM check
  return 'insufficient';
}

export function hybridSearch(packs: Record<string, DB>, query: string, qvec: Float32Array, topN = 6,
  tau?: { cos: number; cov: number }): { top: Hit[]; decision: GateDecision } {
  const all = Object.entries(packs).flatMap(([n, db]) => searchPack(n, db, query, qvec));
  all.sort((a, b) => b.rrf - a.rrf);
  const top = all.slice(0, topN);
  return { top, decision: gate(query, top, tau?.cos, tau?.cov) };
}

/** Prompt for the borderline case: the model must answer strictly YES or NO. */
export const borderlinePrompt = (q: string, hits: Hit[]) =>
  `Question: ${q}\n\nSources:\n${hits.map((h, i) => `[${i + 1}] ${h.text.slice(0, 600)}`).join('\n')}\n\n` +
  'Do these sources contain the information needed to answer the question? Reply with exactly YES or NO.';

export const REFUSAL =
  "I don't have reliable information about that in my offline knowledge packs. " +
  'Connect to the internet (and allow web search) or install the relevant pack, and I can look it up.';
