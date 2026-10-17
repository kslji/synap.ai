/**
 * Incremental index of one granted folder.
 * A short pause between batches keeps the laptop usable. File watching is debounced.
 * Removing a grant deletes index rows. The files on disk stay where they are.
 */
import { readdirSync, statSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import { chunkBlocks, locatorOf } from '../chunker.js'
import { hashEmbed, type CodeEmbedder } from '../code/embed.js'
import { extractGrantedFile, type ExtractOpts } from './extract.js'
import { canReadPath } from './permissions.js'
import { baseName, type PathStyle } from './paths.js'
import {
  fileRow,
  forgetFile,
  listFilePaths,
  saveFileChunks,
  updateGrantProgress,
  type FileDb,
  type StoredChunk,
} from './store.js'

export const INDEX_BATCH = 8
export const INDEX_GAP_MS = 200
export const WATCH_DEBOUNCE_MS = 1500
export const INDEX_MAX_FILES = 20000
export const INDEX_MAX_BYTES = 40 * 1024 * 1024
export const INDEX_LIMIT_MIN = 1
export const INDEX_LIMIT_MAX = 100_000

const INDEX_EXT = new Set([
  'pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'md', 'html', 'htm', 'png', 'jpg', 'jpeg',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'h', 'cc', 'cpp', 'hpp',
])

export const DEFAULT_INDEX_EXTENSIONS = [...INDEX_EXT]

export function parseExtensions(text: string | null | undefined): string[] {
  const parts = (text ?? '')
    .split(/[^a-z0-9_+-]+/i)
    .map((part) => part.trim().toLowerCase().replace(/^\./, ''))
    .filter((part) => /^[a-z0-9_+-]{1,16}$/.test(part))
  const unique = [...new Set(parts)]
  return unique.length ? unique : [...DEFAULT_INDEX_EXTENSIONS]
}

export function clampMaxFiles(value: number): number {
  if (!Number.isFinite(value)) return INDEX_MAX_FILES
  return Math.min(INDEX_LIMIT_MAX, Math.max(INDEX_LIMIT_MIN, Math.round(value)))
}

export function filesPerSecond(count: number, startedMs: number, now = Date.now()): number {
  const seconds = Math.max((now - startedMs) / 1000, 0.001)
  return Math.round((count / seconds) * 10) / 10
}

export interface DiskFile {
  path: string
  name: string
  size: number
  mtimeMs: number
}

export interface IndexProgress {
  grantId: string
  path: string
  done: number
  total: number
  byteSize: number
  status: 'indexing' | 'ready' | 'error' | 'paused'
  error: string | null
  filesPerSec?: number | null
}

export interface IndexDeps {
  style: PathStyle
  roots: readonly string[]
  embedder: CodeEmbedder
  embedderKind?: 'gemma' | 'hash'
  extract?: ExtractOpts
  sleep?: (ms: number) => Promise<void>
  onProgress?: (progress: IndexProgress) => void
  readdir?: (dir: string) => string[]
  stat?: (file: string) => { isDirectory: () => boolean; isFile: () => boolean; size: number; mtimeMs: number }
  batchSize?: number
  gapMs?: number
  maxFiles?: number
  extensions?: readonly string[]
  paused?: () => boolean
}

export function listIndexable(root: string, style: PathStyle, roots: readonly string[], fns?: Pick<IndexDeps, 'readdir' | 'stat'>, maxFiles = INDEX_MAX_FILES, extensions: ReadonlySet<string> = INDEX_EXT): DiskFile[] {
  const readdir = fns?.readdir ?? readdirSync
  const stat = fns?.stat ?? statSync
  const out: DiskFile[] = []
  const visit = (dir: string, depth: number) => {
    if (depth > 12 || out.length >= maxFiles) return
    let names: string[] = []
    try { names = readdir(dir) } catch { return }
    for (const name of names) {
      if (out.length >= maxFiles) return
      const full = join(dir, name)
      if (!canReadPath(full, roots, style)) continue
      let info: ReturnType<NonNullable<IndexDeps['stat']>>
      try { info = stat(full) } catch { continue }
      if (info.isDirectory()) {
        visit(full, depth + 1)
        continue
      }
      if (!info.isFile()) continue
      if (info.size <= 0 || info.size > INDEX_MAX_BYTES) continue
      if (!extensions.has(extension(name))) continue
      out.push({ path: full, name, size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  visit(root, 0)
  return out
}

export async function indexGrant(db: FileDb, grantId: string, root: string, deps: IndexDeps): Promise<{ files: number; bytes: number; filesPerSec: number; paused: boolean }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const batchSize = deps.batchSize ?? INDEX_BATCH
  const gapMs = deps.gapMs ?? INDEX_GAP_MS
  const extensions = new Set((deps.extensions ?? DEFAULT_INDEX_EXTENSIONS).map((ext) => ext.toLowerCase()))
  const files = listIndexable(root, deps.style, deps.roots, deps, deps.maxFiles ?? INDEX_MAX_FILES, extensions)
  const seen = new Set(files.map((file) => file.path))
  for (const row of listFilePaths(db, grantId)) {
    if (!seen.has(row.path)) forgetFile(db, row.id)
  }
  let done = 0
  let bytes = 0
  const started = Date.now()
  const rate = () => filesPerSecond(done, started)
  if (deps.paused?.()) {
    updateGrantProgress(db, grantId, { fileCount: files.length, indexedCount: 0, byteSize: 0, status: 'paused', error: null })
    deps.onProgress?.({ grantId, path: root, done: 0, total: files.length, byteSize: 0, status: 'paused', error: null, filesPerSec: 0 })
    return { files: 0, bytes: 0, filesPerSec: 0, paused: true }
  }
  updateGrantProgress(db, grantId, { fileCount: files.length, indexedCount: 0, byteSize: 0, status: 'indexing', error: null })
  deps.onProgress?.({ grantId, path: root, done: 0, total: files.length, byteSize: 0, status: 'indexing', error: null, filesPerSec: 0 })
  for (const file of files) {
    if (deps.paused?.()) {
      const filesPerSec = rate()
      updateGrantProgress(db, grantId, { indexedCount: done, byteSize: bytes, status: 'paused', error: null })
      deps.onProgress?.({ grantId, path: root, done, total: files.length, byteSize: bytes, status: 'paused', error: null, filesPerSec })
      return { files: done, bytes, filesPerSec, paused: true }
    }
    const previous = fileRow(db, grantId, file.path)
    if (previous && previous.mtimeMs === file.mtimeMs && previous.size === file.size) {
      done += 1
      bytes += file.size
      continue
    }
    try {
      const blocks = await extractGrantedFile(file.path, {
        style: deps.style,
        roots: deps.roots,
        ...deps.extract,
      })
      const chunks = await embedChunks(blocks, file.name, deps.embedder)
      saveFileChunks(db, grantId, file, chunks)
    } catch {
      /* unreadable or empty: counted as seen, not stored */
    }
    done += 1
    bytes += file.size
    updateGrantProgress(db, grantId, { indexedCount: done, byteSize: bytes, status: 'indexing' })
    deps.onProgress?.({ grantId, path: root, done, total: files.length, byteSize: bytes, status: 'indexing', error: null, filesPerSec: rate() })
    if (done % batchSize === 0 && done < files.length) await sleep(gapMs)
  }
  const finished = Date.now()
  const filesPerSec = filesPerSecond(done, started, finished)
  updateGrantProgress(db, grantId, { fileCount: files.length, indexedCount: done, byteSize: bytes, status: 'ready', error: null, lastIndexedAt: finished, embedder: deps.embedderKind })
  deps.onProgress?.({ grantId, path: root, done, total: files.length, byteSize: bytes, status: 'ready', error: null, filesPerSec })
  return { files: done, bytes, filesPerSec, paused: false }
}

async function embedChunks(blocks: { text: string; heading?: string | null; page?: number | null; slide?: number | null; sheet?: string | null }[], name: string, embedder: CodeEmbedder): Promise<StoredChunk[]> {
  const pieces = chunkBlocks(blocks)
  if (!pieces.length) return []
  const vectors = await embedder.embedDocs(pieces.map((piece) => ({ title: name, text: piece.text })))
  return pieces.map((piece, index) => ({
    heading: piece.heading,
    locator: locatorOf(piece),
    text: piece.text,
    vector: vectors[index] ?? hashEmbed(piece.text, embedder.dim),
  }))
}

export type WatchHandle = { close: () => void }
export type WatchFn = (root: string, onChange: () => void) => WatchHandle

export function fsWatch(root: string, onChange: () => void): WatchHandle {
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, onChange)
  } catch {
    return { close() { /* nothing to close */ } }
  }
  watcher.on('error', () => undefined)
  return { close() { watcher.close() } }
}

export function createWatcher(root: string, onChange: () => void, watchImpl: WatchFn = fsWatch, debounceMs = WATCH_DEBOUNCE_MS): WatchHandle {
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const handle = watchImpl(root, () => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { if (!closed) onChange() }, debounceMs)
  })
  return {
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      handle.close()
    },
  }
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function indexableName(name: string): boolean {
  return INDEX_EXT.has(extension(baseName(name)))
}
