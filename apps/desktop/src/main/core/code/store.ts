import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { migrate, openUserDb, vecExtensionPath, type DB } from '../db.js'
import { CODE_SCHEMA } from './schema.js'
import type { ChunkDraft } from './chunks.js'
import type { ExtractedEdge, ExtractedSymbol } from './parse.js'
import { vectorBytes } from './embed.js'

export type CodeDb = DB

export function openCodeDb(path: string, keyHex: string | null): CodeDb {
  mkdirSync(dirname(path), { recursive: true })
  if (keyHex) return openUserDb(path, keyHex, [CODE_SCHEMA])
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.loadExtension(vecExtensionPath())
  migrate(db, [CODE_SCHEMA])
  return db
}

export interface FileRow {
  id: number
  path: string
  sha256: string
  language: string
}

export function listFiles(db: CodeDb): FileRow[] {
  return db.prepare('SELECT id, path, sha256, language FROM files').all() as FileRow[]
}

export function metaGet(db: CodeDb, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function metaSet(db: CodeDb, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

function sqlId(id: number): number {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('bad row id')
  return id
}

function deleteVectors(db: CodeDb, fileId: number): void {
  const ids = db.prepare('SELECT id FROM chunks WHERE file_id = ?').all(fileId) as { id: number }[]
  for (const row of ids) db.prepare(`DELETE FROM chunk_vec WHERE chunk_id = ${sqlId(Number(row.id))}`).run()
}

export function deletePath(db: CodeDb, rel: string): void {
  const row = db.prepare('SELECT id FROM files WHERE path = ?').get(rel) as { id: number } | undefined
  if (!row) return
  deleteVectors(db, row.id)
  db.prepare('DELETE FROM files WHERE id = ?').run(row.id)
}

export interface WrittenFile {
  path: string
  symbols: ExtractedSymbol[]
  edges: ExtractedEdge[]
  chunks: ChunkDraft[]
  vectors: Float32Array[] | null
  sha256: string
  size: number
  mtimeMs: number
  language: string
}

export function writeFileIndex(db: CodeDb, file: WrittenFile): void {
  const tx = db.transaction(() => {
    deletePath(db, file.path)
    const info = db.prepare(
      'INSERT INTO files(path, sha256, size_bytes, mtime_ms, language) VALUES (?, ?, ?, ?, ?)',
    ).run(file.path, file.sha256, file.size, file.mtimeMs, file.language)
    const fileId = Number(info.lastInsertRowid)
    const insertSymbol = db.prepare(
      `INSERT INTO symbols(file_id, name, qualified, kind, start_line, end_line, signature, parent_name, text, module)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const symbol of file.symbols) {
      insertSymbol.run(fileId, symbol.name, symbol.qualified, symbol.kind, symbol.startLine, symbol.endLine, symbol.signature, symbol.parentName, symbol.text, symbol.module)
    }
    const insertEdge = db.prepare(
      `INSERT INTO edges(file_id, src_qualified, kind, dst_name, dst_module, line) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const edge of file.edges) {
      insertEdge.run(fileId, edge.srcQualified, edge.kind, edge.dstName, edge.dstModule, edge.line)
    }
    const insertChunk = db.prepare(
      `INSERT INTO chunks(file_id, path, name, kind, start_line, end_line, text, embedded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertVec = (id: number) => db.prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (${sqlId(id)}, ?)`)
    file.chunks.forEach((chunk, index) => {
      const vector = file.vectors?.[index]
      const row = insertChunk.run(fileId, file.path, chunk.name, chunk.kind, chunk.startLine, chunk.endLine, chunk.text, vector ? 1 : 0)
      if (vector) insertVec(Number(row.lastInsertRowid)).run(vectorBytes(vector))
    })
  })
  tx()
}

export interface SymbolHit {
  id: number
  name: string
  qualified: string
  kind: string
  path: string
  startLine: number
  endLine: number
  signature: string
  text: string
  module: string | null
}

export function definitions(db: CodeDb, name: string, preferPath?: string): SymbolHit[] {
  const rows = db.prepare(
    `SELECT s.id, s.name, s.qualified, s.kind, f.path AS path, s.start_line AS startLine, s.end_line AS endLine,
            s.signature, s.text, s.module
     FROM symbols s JOIN files f ON f.id = s.file_id
     WHERE (s.name = ? OR s.qualified = ?) AND s.kind NOT IN ('import', 'section')
     ORDER BY s.start_line`,
  ).all(name, name) as SymbolHit[]
  if (!preferPath) return rows
  return rows.sort((a, b) => (a.path === preferPath ? 0 : 1) - (b.path === preferPath ? 0 : 1))
}

export interface RefHit {
  path: string
  line: number
  kind: string
  dstName: string
  srcQualified: string | null
}

export function referencesTo(db: CodeDb, name: string): RefHit[] {
  return db.prepare(
    `SELECT f.path AS path, e.line AS line, e.kind AS kind, e.dst_name AS dstName, e.src_qualified AS srcQualified
     FROM edges e JOIN files f ON f.id = e.file_id
     WHERE e.kind IN ('calls', 'references', 'imports')
       AND (e.dst_name = ? OR e.dst_symbol_id IN (SELECT id FROM symbols WHERE name = ? OR qualified = ?))
     ORDER BY f.path, e.line`,
  ).all(name, name, name) as RefHit[]
}

export interface RelatedHit { path: string; reason: string }

export function relatedFiles(db: CodeDb, path: string): RelatedHit[] {
  const out = new Map<string, string>()
  const imports = db.prepare(
    `SELECT e.dst_path AS path FROM edges e JOIN files f ON f.id = e.file_id
     WHERE f.path = ? AND e.kind = 'imports' AND e.dst_path IS NOT NULL AND e.dst_path != ?`,
  ).all(path, path) as { path: string }[]
  for (const row of imports) out.set(row.path, 'imports')
  const importedBy = db.prepare(
    `SELECT f.path AS path FROM edges e JOIN files f ON f.id = e.file_id
     WHERE e.kind = 'imports' AND e.dst_path = ? AND f.path != ?`,
  ).all(path, path) as { path: string }[]
  for (const row of importedBy) if (!out.has(row.path)) out.set(row.path, 'imported by')
  const names = db.prepare(
    `SELECT s.name FROM symbols s JOIN files f ON f.id = s.file_id
     WHERE f.path = ? AND s.kind IN ('function', 'method', 'class', 'type')`,
  ).all(path) as { name: string }[]
  if (names.length) {
    const placeholders = names.map(() => '?').join(',')
    const callers = db.prepare(
      `SELECT DISTINCT f.path AS path FROM edges e JOIN files f ON f.id = e.file_id
       WHERE e.kind = 'calls' AND e.dst_name IN (${placeholders}) AND f.path != ?`,
    ).all(...names.map((row) => row.name), path) as { path: string }[]
    for (const row of callers) if (!out.has(row.path)) out.set(row.path, 'calls into this file')
  }
  return [...out.entries()].map(([file, reason]) => ({ path: file, reason }))
}

export interface ImpactHit {
  path: string
  line: number
  kind: string
  symbol: string | null
}

export function impactOf(db: CodeDb, name: string): ImpactHit[] {
  return db.prepare(
    `SELECT f.path AS path, e.line AS line, e.kind AS kind, e.src_qualified AS symbol
     FROM edges e JOIN files f ON f.id = e.file_id
     WHERE e.kind IN ('calls', 'references', 'imports') AND e.dst_name = ?
     ORDER BY f.path, e.line`,
  ).all(name) as ImpactHit[]
}

interface SymbolLink { id: number; name: string; qualified: string; kind: string; path: string; fileId: number }

export function linkEdges(db: CodeDb): void {
  const symbols = db.prepare(
    `SELECT s.id, s.name, s.qualified, s.kind, f.path AS path, s.file_id AS fileId
     FROM symbols s JOIN files f ON f.id = s.file_id
     WHERE s.kind NOT IN ('import', 'section')`,
  ).all() as SymbolLink[]
  const byName = new Map<string, SymbolLink[]>()
  for (const symbol of symbols) {
    const list = byName.get(symbol.name) ?? []
    list.push(symbol)
    byName.set(symbol.name, list)
  }
  const files = db.prepare('SELECT id, path FROM files').all() as { id: number; path: string }[]
  const pathSet = new Set(files.map((file) => file.path))
  const fileById = new Map(files.map((file) => [file.id, file.path]))

  const importEdges = db.prepare(
    `SELECT id, file_id AS fileId, dst_module AS dstModule FROM edges WHERE kind = 'imports'`,
  ).all() as { id: number; fileId: number; dstModule: string | null }[]
  const setPath = db.prepare('UPDATE edges SET dst_path = ? WHERE id = ?')
  const importsByFile = new Map<number, Set<string>>()
  for (const edge of importEdges) {
    const from = fileById.get(edge.fileId)
    if (!from || !edge.dstModule) continue
    const resolved = resolveModule(from, edge.dstModule, pathSet)
    if (!resolved) continue
    setPath.run(resolved, edge.id)
    const set = importsByFile.get(edge.fileId) ?? new Set<string>()
    set.add(resolved)
    importsByFile.set(edge.fileId, set)
  }

  const pending = db.prepare(
    `SELECT id, file_id AS fileId, dst_name AS dstName FROM edges WHERE kind IN ('calls', 'references')`,
  ).all() as { id: number; fileId: number; dstName: string }[]
  const setSymbol = db.prepare('UPDATE edges SET dst_symbol_id = ?, dst_path = ? WHERE id = ?')
  const clearSymbol = db.prepare('UPDATE edges SET dst_symbol_id = NULL WHERE id = ?')
  for (const edge of pending) {
    const candidates = byName.get(edge.dstName) ?? []
    const picked = pickSymbol(candidates, fileById.get(edge.fileId) ?? '', importsByFile.get(edge.fileId))
    if (picked) setSymbol.run(picked.id, picked.path, edge.id)
    else clearSymbol.run(edge.id)
  }

  db.prepare(
    `DELETE FROM edges WHERE kind = 'references' AND dst_name NOT IN (
       SELECT name FROM symbols WHERE kind NOT IN ('import', 'section')
     )`,
  ).run()
}

function pickSymbol(candidates: SymbolLink[], fromPath: string, imported: Set<string> | undefined): SymbolLink | null {
  if (!candidates.length) return null
  const same = candidates.find((symbol) => symbol.path === fromPath)
  if (same) return same
  if (imported) {
    const via = candidates.find((symbol) => imported.has(symbol.path))
    if (via) return via
  }
  return candidates.length === 1 ? candidates[0]! : null
}

const CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.pyi', '.go', '.rs', '.java', '.c', '.h', '.cc', '.cpp', '.hpp', '.hh']

export function resolveModule(fromPath: string, spec: string, files: Set<string>): string | null {
  const raw = spec.trim().replace(/\\/g, '/')
  if (!raw || raw === '.') return null
  const candidates: string[] = []
  if (raw.startsWith('.')) {
    const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : ''
    const parts = `${dir}/${raw}`.split('/')
    const stack: string[] = []
    for (const part of parts) {
      if (part === '' || part === '.') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    const base = stack.join('/')
    candidates.push(base)
    for (const ext of CODE_EXTS) candidates.push(base + ext)
    for (const ext of ['.ts', '.tsx', '.js', '.py']) candidates.push(`${base}/index${ext}`, `${base}/__init__${ext}`)
  } else if (raw.endsWith('.h') || raw.endsWith('.hpp') || raw.includes('/')) {
    const base = raw.split('/').at(-1) ?? raw
    const sameDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) + base : base
    candidates.push(sameDir, base)
    for (const file of files) if (file === base || file.endsWith('/' + base)) return file
  } else if (raw.includes('.')) {
    const asPath = raw.replace(/\./g, '/')
    candidates.push(asPath + '.py', asPath + '.java', asPath + '/__init__.py', asPath + '.pyi')
  } else {
    const base = raw.split('/').at(-1) ?? raw
    for (const file of files) if (file.endsWith('/' + base) || file.endsWith('/' + base + '.go') || file.endsWith('/' + base + '.py')) return file
  }
  for (const candidate of candidates) if (files.has(candidate)) return candidate
  return null
}

export function counts(db: CodeDb): { files: number; symbols: number; chunks: number; embedded: number } {
  const files = (db.prepare('SELECT COUNT(*) AS n FROM files').get() as { n: number }).n
  const symbols = (db.prepare('SELECT COUNT(*) AS n FROM symbols').get() as { n: number }).n
  const chunks = (db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number }).n
  const embedded = (db.prepare('SELECT COUNT(*) AS n FROM chunks WHERE embedded = 1').get() as { n: number }).n
  return { files, symbols, chunks, embedded }
}

export interface PendingChunk { id: number; name: string; text: string }

export function pendingChunks(db: CodeDb, limit: number): PendingChunk[] {
  return db.prepare(
    'SELECT id, name, text FROM chunks WHERE embedded = 0 ORDER BY id LIMIT ?',
  ).all(limit) as PendingChunk[]
}

export function markEmbedded(db: CodeDb, rows: { id: number; vector: Float32Array }[]): void {
  const mark = db.prepare('UPDATE chunks SET embedded = 1 WHERE id = ?')
  const tx = db.transaction(() => {
    for (const row of rows) {
      const id = sqlId(row.id)
      db.prepare(`DELETE FROM chunk_vec WHERE chunk_id = ${id}`).run()
      db.prepare(`INSERT INTO chunk_vec(chunk_id, embedding) VALUES (${id}, ?)`).run(vectorBytes(row.vector))
      mark.run(id)
    }
  })
  tx()
}
