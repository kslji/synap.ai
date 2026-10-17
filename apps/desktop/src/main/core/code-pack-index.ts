/**
 * On-device embeddings for the Code pack.
 * The signed pack stays text plus a keyword index. This cache is local and
 * is rebuilt when the pack version changes. Chat can pause the loop.
 */
import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CodeEmbedder } from './code/embed.js'
import { vectorBytes } from './code/embed.js'
import { vecExtensionPath, type DB } from './db.js'
import { EMBEDDINGGEMMA2_256 } from './embedding.js'

export interface IndexProgress {
  state: 'pending' | 'indexing' | 'ready' | 'off' | 'error'
  done: number
  total: number
  error: string | null
}

const idle: IndexProgress = { state: 'pending', done: 0, total: 0, error: null }
let progress: IndexProgress = { ...idle }
let running = false

export function codePackIndexProgress(): IndexProgress {
  return { ...progress }
}

export function resetCodePackIndexProgress(): void {
  progress = { ...idle }
  running = false
}

export function codePackVectorPath(dir: string): string {
  return `${dir.replace(/\/$/, '')}/embeddings.sqlite`
}

export async function indexCodePackEmbeddings(opts: {
  packDb: DB
  cachePath: string
  embedder: CodeEmbedder
  packVersion: string
  batchSize?: number
  /** Stop after this many new vectors so a chat can use the model. */
  maxChunks?: number
  busy?: () => boolean
  onProgress?: (progress: IndexProgress) => void
}): Promise<IndexProgress> {
  if (running) return codePackIndexProgress()
  running = true
  try {
    mkdirSync(dirname(opts.cachePath), { recursive: true })
    const cache = openVectorCache(opts.cachePath)
    try {
      const spec = `${opts.packVersion}\n${EMBEDDINGGEMMA2_256.id}\n${opts.embedder.dim}`
      const stored = cache.prepare("SELECT value FROM meta WHERE key = 'spec'").get() as { value: string } | undefined
      if (stored?.value !== spec) {
        cache.exec('DELETE FROM chunk_vec')
        cache.prepare("INSERT INTO meta(key, value) VALUES ('spec', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(spec)
      }
      const have = cache.prepare('SELECT chunk_id AS id FROM chunk_vec').all() as { id: number }[]
      const doneIds = new Set(have.map((row) => row.id))
      const ids = opts.packDb.prepare('SELECT id FROM chunks ORDER BY id').all() as { id: number }[]
      const pending = ids.filter((row) => !doneIds.has(row.id))
      const report = (state: IndexProgress['state'], done: number, error: string | null = null) => {
        progress = { state, done, total: ids.length, error }
        opts.onProgress?.(progress)
        return progress
      }
      if (!pending.length) return report('ready', ids.length)
      report('indexing', ids.length - pending.length)
      const read = opts.packDb.prepare('SELECT id, citation AS title, text FROM chunks WHERE id = ?')
      const size = opts.batchSize ?? 8
      const cap = opts.maxChunks ?? pending.length
      const work = pending.slice(0, cap)
      for (let i = 0; i < work.length; i += size) {
        if (opts.busy?.()) return report('indexing', ids.length - pending.length + i)
        const slice = work.slice(i, i + size)
        const docs = slice.map((row) => read.get(row.id) as { id: number; title: string; text: string })
        const vectors = await opts.embedder.embedDocs(docs.map((doc) => ({ title: doc.title, text: doc.text })))
        const tx = cache.transaction(() => {
          docs.forEach((doc, index) => insertVector(cache, doc.id, vectors[index]))
        })
        tx()
        report('indexing', ids.length - pending.length + i + slice.length)
      }
      const left = pending.length - work.length
      return report(left === 0 ? 'ready' : 'indexing', ids.length - left)
    } finally {
      cache.close()
    }
  } catch (error) {
    progress = { state: 'error', done: progress.done, total: progress.total, error: (error as Error).message }
    opts.onProgress?.(progress)
    return progress
  } finally {
    running = false
  }
}

function openVectorCache(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.loadExtension(vecExtensionPath())
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vec USING vec0(
      chunk_id INTEGER PRIMARY KEY,
      embedding float[${EMBEDDINGGEMMA2_256.dim}]
    );
  `)
  return db
}

export function openCodePackVectors(path: string): DB | null {
  if (!existsSync(path)) return null
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true })
    db.pragma('query_only = ON')
    db.loadExtension(vecExtensionPath())
    return db
  } catch {
    return null
  }
}

/** Test hook: a cache that already has vectors for the given rows. */
export function writeVectorCache(path: string, packVersion: string, rows: { id: number; vector: Float32Array }[]): DB {
  const db = openVectorCache(path)
  db.prepare("INSERT INTO meta(key, value) VALUES ('spec', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(`${packVersion}\n${EMBEDDINGGEMMA2_256.id}\n${rows[0]?.vector.length ?? EMBEDDINGGEMMA2_256.dim}`)
  for (const row of rows) insertVector(db, row.id, row.vector)
  return db
}

function insertVector(db: DB, id: number, vector: Float32Array): void {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('bad row id')
  db.prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (${id}, ?)`).run(vectorBytes(vector))
}
