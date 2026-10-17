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

const INDEX_EXT = new Set([
  'pdf', 'docx', 'pptx', 'xlsx', 'csv', 'txt', 'md', 'html', 'htm', 'png', 'jpg', 'jpeg',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'h', 'cc', 'cpp', 'hpp',
])

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
  status: 'indexing' | 'ready' | 'error'
  error: string | null
}

export interface IndexDeps {
  style: PathStyle
  roots: readonly string[]
  embedder: CodeEmbedder
  extract?: ExtractOpts
  sleep?: (ms: number) => Promise<void>
  onProgress?: (progress: IndexProgress) => void
  readdir?: (dir: string) => string[]
  stat?: (file: string) => { isDirectory: () => boolean; isFile: () => boolean; size: number; mtimeMs: number }
  batchSize?: number
  gapMs?: number
  maxFiles?: number
}

export function listIndexable(root: string, style: PathStyle, roots: readonly string[], fns?: Pick<IndexDeps, 'readdir' | 'stat'>, maxFiles = INDEX_MAX_FILES): DiskFile[] {
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
      if (!INDEX_EXT.has(extension(name))) continue
      out.push({ path: full, name, size: info.size, mtimeMs: info.mtimeMs })
    }
  }
  visit(root, 0)
  return out
}

export async function indexGrant(db: FileDb, grantId: string, root: string, deps: IndexDeps): Promise<{ files: number; bytes: number }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const batchSize = deps.batchSize ?? INDEX_BATCH
  const gapMs = deps.gapMs ?? INDEX_GAP_MS
  const files = listIndexable(root, deps.style, deps.roots, deps, deps.maxFiles ?? INDEX_MAX_FILES)
  const seen = new Set(files.map((file) => file.path))
  for (const row of listFilePaths(db, grantId)) {
    if (!seen.has(row.path)) forgetFile(db, row.id)
  }
  let done = 0
  let bytes = 0
  updateGrantProgress(db, grantId, { fileCount: files.length, indexedCount: 0, byteSize: 0, status: 'indexing', error: null })
  deps.onProgress?.({ grantId, path: root, done: 0, total: files.length, byteSize: 0, status: 'indexing', error: null })
  for (const file of files) {
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
    deps.onProgress?.({ grantId, path: root, done, total: files.length, byteSize: bytes, status: 'indexing', error: null })
    if (done % batchSize === 0 && done < files.length) await sleep(gapMs)
  }
  const finished = Date.now()
  updateGrantProgress(db, grantId, { fileCount: files.length, indexedCount: done, byteSize: bytes, status: 'ready', error: null, lastIndexedAt: finished })
  deps.onProgress?.({ grantId, path: root, done, total: files.length, byteSize: bytes, status: 'ready', error: null })
  return { files: done, bytes }
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
