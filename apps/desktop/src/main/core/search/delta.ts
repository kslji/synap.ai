/**
 * Open a signed NaCl secretbox delta next to a plaintext pack.sqlite.
 * The plaintext file is unchanged. The builder encrypts with PACK_CONTENT_KEY.
 * The app decrypts with that key after unwrapping the server's seal, or with
 * the operator override SURF_PACK_CONTENT_KEY. The licence-derived key is
 * only the wrap key.
 */
import nacl from 'tweetnacl'
import type { DB } from '../db.js'
import type { Hit } from '../retrieval.js'

export const DELTA_FILE = 'delta.sqlite.enc'
const SQLITE_MAGIC = 'SQLite format 3\0'
const SCAN_CAP = 2000

/** Cached unwrapped content key, then the optional operator override. */
export function contentKeysForDelta(cached: Buffer | null, envHex: string | undefined): Buffer[] {
  const keys: Buffer[] = []
  if (cached?.length === 32) keys.push(cached)
  if (envHex && /^[0-9a-f]{64}$/i.test(envHex)) {
    const env = Buffer.from(envHex, 'hex')
    if (!keys.some((key) => key.equals(env))) keys.push(env)
  }
  return keys
}

/** Open the server's seal. The result is the 32-byte builder content key. */
export function openSealedContentKey(sealed: Uint8Array, wrapKey: Uint8Array): Buffer | null {
  const opened = secretboxOpen(sealed, wrapKey)
  if (!opened || opened.length !== 32) return null
  return Buffer.from(opened)
}

/** PyNaCl SecretBox.encrypt layout: 24-byte nonce, then the secretbox. */
export function secretboxOpen(blob: Uint8Array, key: Uint8Array): Uint8Array | null {
  if (key.length !== 32 || blob.length < 40) return null
  const opened = nacl.secretbox.open(blob.subarray(24), blob.subarray(0, 24), key)
  return opened || null
}

export function decryptDelta(blob: Buffer, keys: Buffer[]): Buffer | null {
  for (const key of keys) {
    const opened = secretboxOpen(blob, key)
    if (!opened) continue
    const plain = Buffer.from(opened)
    if (plain.subarray(0, 16).toString('utf8') !== SQLITE_MAGIC) continue
    return plain
  }
  return null
}

function cosine(query: ArrayLike<number>, embedding: Buffer, dim: number): number {
  if (embedding.length < dim * 4 || query.length < dim) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < dim; i++) {
    const value = embedding.readFloatLE(i * 4)
    const q = query[i] ?? 0
    dot += q * value
    na += q * q
    nb += value * value
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
}

/** Delta files store float32 blobs. They do not have the pack FTS or vec0 index. */
export function searchDelta(name: string, db: DB, query: string, qvec: ArrayLike<number> | null, k = 8): Hit[] {
  const rows = db.prepare(
    `SELECT c.id AS id, c.text AS text, d.title AS title, d.url AS url, e.embedding AS embedding, e.dim AS dim
     FROM chunks c
     JOIN documents d ON d.id = c.doc_id
     JOIN embeddings e ON e.chunk_id = c.id
     LIMIT ?`,
  ).all(SCAN_CAP) as { id: number; text: string; title: string | null; url: string | null; embedding: Buffer; dim: number }[]
  const words = query.toLowerCase().split(/\W+/).filter((word) => word.length > 3)
  const ranked = rows.map((row) => {
    const score = qvec ? cosine(qvec, row.embedding, row.dim) : 0
    const hay = row.text.toLowerCase()
    const overlap = words.length ? words.filter((word) => hay.includes(word)).length / words.length : 0
    return { row, score, overlap }
  })
  ranked.sort((a, b) => (b.score + b.overlap) - (a.score + a.overlap))
  return ranked.slice(0, k).map((item, index) => ({
    pack: name,
    chunkId: item.row.id,
    text: item.row.text,
    title: item.row.title ?? '',
    url: item.row.url ?? '',
    cosine: item.score,
    bm25Rank: item.overlap > 0 ? index : null,
    vecRank: index,
    rrf: item.score + item.overlap,
  }))
}
