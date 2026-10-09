/**
 * Attachments, jobs, and chunks inside the encrypted user database.
 * Same bytes (SHA-256) are stored once. Deleting a file deletes its chunks and vectors.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { TextChunk } from './chunker.js'
import { locatorOf } from './chunker.js'
import type { DB } from './db.js'
import type { LibraryFile } from './ipc-contract.js'

export interface AddedFile {
  attachmentId: string
  jobId: string | null
  created: boolean
}

export function addBytes(db: DB, root: string, name: string, mime: string, bytes: Buffer, conversationId: string | null): AddedFile {
  const sha = createHash('sha256').update(bytes).digest('hex')
  const now = Date.now()
  const existing = db.prepare('SELECT id FROM attachments WHERE sha256 = ?').get(sha) as { id: string } | undefined
  if (existing) {
    if (conversationId) linkReplacingSameName(db, conversationId, existing.id, name, now)
    const jobId = ensureJob(db, existing.id, conversationId ? 1 : 5, now)
    return { attachmentId: existing.id, jobId, created: false }
  }
  const id = randomUUID()
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin'
  const stored = join(sha.slice(0, 2), sha.slice(2, 4), `${sha}.${ext || 'bin'}`)
  mkdirSync(dirname(join(root, stored)), { recursive: true })
  writeFileSync(join(root, stored), bytes)
  const jobId = randomUUID()
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO attachments (id, sha256, original_name, mime, size_bytes, stored_path, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, sha, name, mime, bytes.length, stored, now)
    db.prepare(
      `INSERT INTO documents (attachment_id, title, mime, content_hash, status, meta_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', '{}', ?, ?)`,
    ).run(id, name, mime, sha, now, now)
    db.prepare(
      `INSERT INTO attachment_jobs (id, attachment_id, status, priority, progress, attempts, created_at)
       VALUES (?, ?, 'queued', ?, 0, 0, ?)`,
    ).run(jobId, id, conversationId ? 1 : 5, now)
    if (conversationId) linkReplacingSameName(db, conversationId, id, name, now)
  })
  tx()
  return { attachmentId: id, jobId, created: true }
}

function linkReplacingSameName(db: DB, conversationId: string, attachmentId: string, name: string, now: number): void {
  db.prepare(
    `DELETE FROM conversation_files
     WHERE conversation_id = ? AND attachment_id IN (
       SELECT id FROM attachments WHERE id != ? AND lower(original_name) = lower(?)
     )`,
  ).run(conversationId, attachmentId, name)
  db.prepare(
    'INSERT INTO conversation_files (conversation_id, attachment_id, added_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
  ).run(conversationId, attachmentId, now)
}

function ensureJob(db: DB, attachmentId: string, priority: number, now: number): string | null {
  const doc = db.prepare('SELECT status FROM documents WHERE attachment_id = ?').get(attachmentId) as { status: string } | undefined
  const open = db.prepare(
    `SELECT id, status FROM attachment_jobs WHERE attachment_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).get(attachmentId) as { id: string; status: string } | undefined
  if (doc?.status === 'ready' && open?.status === 'done') return null
  if (open && (open.status === 'queued' || open.status === 'running')) return open.id
  if (open && (open.status === 'failed' || open.status === 'cancelled')) {
    db.prepare(
      `UPDATE attachment_jobs SET status = 'queued', priority = ?, error = NULL, progress = 0, stage = NULL, finished_at = NULL WHERE id = ?`,
    ).run(priority, open.id)
    return open.id
  }
  const id = randomUUID()
  db.prepare(
    `INSERT INTO attachment_jobs (id, attachment_id, status, priority, progress, attempts, created_at) VALUES (?, ?, 'queued', ?, 0, 0, ?)`,
  ).run(id, attachmentId, priority, now)
  return id
}

export interface ClaimedJob {
  id: string
  attachmentId: string
}

export function requeueInterrupted(db: DB): void {
  db.prepare(`UPDATE attachment_jobs SET status = 'queued', stage = NULL WHERE status = 'running'`).run()
}

export function claimNext(db: DB): ClaimedJob | null {
  const row = db.prepare(
    `SELECT id, attachment_id AS attachmentId FROM attachment_jobs
     WHERE status = 'queued' ORDER BY priority ASC, created_at ASC LIMIT 1`,
  ).get() as ClaimedJob | undefined
  if (!row) return null
  db.prepare(
    `UPDATE attachment_jobs SET status = 'running', started_at = ?, attempts = attempts + 1, stage = 'Reading', progress = 0.02 WHERE id = ?`,
  ).run(Date.now(), row.id)
  return row
}

export function hasQueued(db: DB): boolean {
  return Boolean(db.prepare(`SELECT 1 AS ok FROM attachment_jobs WHERE status = 'queued'`).get())
}

export function jobState(db: DB, jobId: string): string | null {
  const row = db.prepare('SELECT status FROM attachment_jobs WHERE id = ?').get(jobId) as { status: string } | undefined
  return row?.status ?? null
}

export function markProgress(db: DB, jobId: string, progress: number, stage: string): void {
  db.prepare(`UPDATE attachment_jobs SET progress = ?, stage = ? WHERE id = ? AND status = 'running'`).run(progress, stage, jobId)
}

export function markDone(db: DB, jobId: string): void {
  db.prepare(
    `UPDATE attachment_jobs SET status = 'done', progress = 1, stage = 'Ready', error = NULL, finished_at = ? WHERE id = ?`,
  ).run(Date.now(), jobId)
}

export function markFailed(db: DB, jobId: string, attachmentId: string, message: string): void {
  const now = Date.now()
  db.prepare(
    `UPDATE attachment_jobs SET status = 'failed', error = ?, stage = 'Failed', finished_at = ? WHERE id = ?`,
  ).run(message, now, jobId)
  const chunks = db.prepare(
    `SELECT count(*) AS n FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.attachment_id = ?`,
  ).get(attachmentId) as { n: number }
  if (!chunks.n) {
    db.prepare(`UPDATE documents SET status = 'failed', updated_at = ? WHERE attachment_id = ?`).run(now, attachmentId)
  }
}

export function markCancelled(db: DB, jobId: string): void {
  db.prepare(
    `UPDATE attachment_jobs SET status = 'cancelled', stage = 'Cancelled', finished_at = ? WHERE id = ? AND status IN ('queued','running')`,
  ).run(Date.now(), jobId)
}

export function retryJob(db: DB, jobId: string): boolean {
  const info = db.prepare(
    `UPDATE attachment_jobs SET status = 'queued', error = NULL, progress = 0, stage = NULL, finished_at = NULL
     WHERE id = ? AND status IN ('failed','cancelled','done')`,
  ).run(jobId)
  return info.changes > 0
}

export function attachmentPath(db: DB, attachmentId: string, root: string): { name: string; abs: string; mime: string } | null {
  const row = db.prepare(
    'SELECT original_name AS name, stored_path AS stored, mime FROM attachments WHERE id = ?',
  ).get(attachmentId) as { name: string; stored: string; mime: string } | undefined
  if (!row) return null
  return { name: row.name, abs: join(root, row.stored), mime: row.mime }
}

export function saveChunks(db: DB, attachmentId: string, chunks: TextChunk[], vectors: Float32Array[], meta: Record<string, unknown> = {}): void {
  if (chunks.length !== vectors.length) throw new Error('chunk and vector counts differ')
  const doc = db.prepare('SELECT id, title FROM documents WHERE attachment_id = ?').get(attachmentId) as { id: number; title: string } | undefined
  if (!doc) throw new Error('missing document row')
  const file = db.prepare('SELECT original_name AS name FROM attachments WHERE id = ?').get(attachmentId) as { name: string }
  const now = Date.now()
  const pages = chunks.map((c) => c.pageEnd ?? c.pageStart ?? 0)
  const pageCount = pages.reduce((m, n) => Math.max(m, n), 0) || null
  const tx = db.transaction(() => {
    const old = db.prepare('SELECT id FROM chunks WHERE document_id = ?').all(doc.id) as { id: number }[]
    for (const row of old) {
      const id = Number(row.id)
      db.prepare(`DELETE FROM chunk_vectors WHERE chunk_id = ${id}`).run()
    }
    db.prepare('DELETE FROM chunks WHERE document_id = ?').run(doc.id)
    const insert = db.prepare(
      `INSERT INTO chunks (document_id, ord, heading, text, word_count, locator_kind, locator_label, page_start, page_end, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    chunks.forEach((chunk, ord) => {
      const heading = [file.name, chunk.heading].filter(Boolean).join(' > ')
      const row = insert.get(doc.id, ord, heading, chunk.text, chunk.wordCount, chunk.locatorKind, chunk.locatorLabel, chunk.pageStart, chunk.pageEnd, now) as { id: number | bigint }
      const id = Number(row.id)
      if (!Number.isSafeInteger(id)) throw new Error('chunk id is not an integer')
      // sqlite-vec rejects a bound parameter for this primary key; the id is our own integer.
      db.prepare(`INSERT INTO chunk_vectors (chunk_id, embedding) VALUES (${id}, ?)`).run(vectorBuffer(vectors[ord]))
    })
    db.prepare(
      `UPDATE documents SET status = 'ready', page_count = ?, meta_json = ?, updated_at = ? WHERE id = ?`,
    ).run(pageCount, JSON.stringify(meta), now, doc.id)
  })
  tx()
}

export function deleteAttachment(db: DB, attachmentId: string, root: string): void {
  const row = db.prepare('SELECT stored_path AS stored FROM attachments WHERE id = ?').get(attachmentId) as { stored: string } | undefined
  if (!row) return
  const ids = db.prepare(
    'SELECT c.id FROM chunks c JOIN documents d ON d.id = c.document_id WHERE d.attachment_id = ?',
  ).all(attachmentId) as { id: number }[]
  const tx = db.transaction(() => {
    for (const id of ids) db.prepare(`DELETE FROM chunk_vectors WHERE chunk_id = ${Number(id.id)}`).run()
    db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId)
  })
  tx()
  rmSync(join(root, row.stored), { force: true })
}

export function listFiles(db: DB, conversationId?: string | null): LibraryFile[] {
  const links = db.prepare('SELECT attachment_id AS id, conversation_id AS conversationId FROM conversation_files').all() as { id: string; conversationId: string }[]
  const byFile = new Map<string, string[]>()
  for (const link of links) {
    const list = byFile.get(link.id) ?? []
    list.push(link.conversationId)
    byFile.set(link.id, list)
  }
  const rows = db.prepare(
    `SELECT a.id, a.original_name AS name, a.mime, a.size_bytes AS sizeBytes, a.added_at AS addedAt,
            j.id AS jobId, j.status AS jobStatus, j.stage, j.progress, j.error,
            d.status AS docStatus,
            (SELECT count(*) FROM chunks c WHERE c.document_id = d.id) AS chunkCount
     FROM attachments a
     LEFT JOIN documents d ON d.attachment_id = a.id
     LEFT JOIN attachment_jobs j ON j.id = (
       SELECT id FROM attachment_jobs WHERE attachment_id = a.id ORDER BY created_at DESC LIMIT 1
     )
     ORDER BY a.added_at DESC`,
  ).all() as Row[]
  const files = rows.map((row) => toFile(row, byFile.get(row.id) ?? []))
  if (!conversationId) return files
  return files.filter((file) => file.conversationIds.includes(conversationId))
}

export function fileById(db: DB, id: string): LibraryFile | null {
  return listFiles(db).find((file) => file.id === id) ?? null
}

export function countsFor(db: DB, conversationId: string | null): { ready: number; pending: number } {
  const files = listFiles(db, conversationId)
  let ready = 0
  let pending = 0
  for (const file of files) {
    if (file.chunkCount > 0 && file.status !== 'queued' && file.status !== 'running') ready++
    else if (file.status === 'queued' || file.status === 'running') pending++
  }
  return { ready, pending }
}

export interface PreviewRow {
  chunkId: number
  fileName: string
  title: string
  heading: string | null
  locator: string | null
  text: string
}

export function previewChunk(db: DB, chunkId: number): PreviewRow | null {
  const row = db.prepare(
    `SELECT c.id AS chunkId, a.original_name AS fileName, d.title AS title, c.heading, c.text,
            c.locator_kind AS locatorKind, c.locator_label AS locatorLabel, c.page_start AS pageStart
     FROM chunks c
     JOIN documents d ON d.id = c.document_id
     JOIN attachments a ON a.id = d.attachment_id
     WHERE c.id = ?`,
  ).get(chunkId) as (PreviewRow & { locatorKind: TextChunk['locatorKind']; locatorLabel: string | null; pageStart: number | null }) | undefined
  if (!row) return null
  return {
    chunkId: row.chunkId,
    fileName: row.fileName,
    title: row.title,
    heading: row.heading,
    locator: locatorOf({ locatorKind: row.locatorKind, locatorLabel: row.locatorLabel, pageStart: row.pageStart }),
    text: row.text,
  }
}

export function previewAttachment(db: DB, attachmentId: string): PreviewRow | null {
  const row = db.prepare(
    `SELECT c.id AS chunkId FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE d.attachment_id = ? ORDER BY c.ord ASC LIMIT 1`,
  ).get(attachmentId) as { chunkId: number } | undefined
  return row ? previewChunk(db, row.chunkId) : null
}

function vectorBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

interface Row {
  id: string
  name: string
  mime: string
  sizeBytes: number
  addedAt: number
  jobId: string | null
  jobStatus: LibraryFile['status'] | null
  stage: string | null
  progress: number | null
  error: string | null
  docStatus: string | null
  chunkCount: number
}

function toFile(row: Row, conversationIds: string[]): LibraryFile {
  const status: LibraryFile['status'] = row.jobStatus ?? (row.docStatus === 'ready' ? 'done' : 'queued')
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    addedAt: row.addedAt,
    conversationIds,
    status,
    stage: row.stage,
    progress: row.progress ?? (status === 'done' ? 1 : 0),
    error: row.error,
    jobId: row.jobId,
    chunkCount: row.chunkCount ?? 0,
  }
}
