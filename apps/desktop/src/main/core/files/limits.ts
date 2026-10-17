/**
 * Index caps live in the file-index meta table.
 * They apply the next time a folder is indexed.
 */
import { clampMaxFiles, DEFAULT_INDEX_EXTENSIONS, filesPerSecond, INDEX_MAX_FILES, parseExtensions } from './indexer.js'
import { metaGet, metaSet, type FileDb } from './store.js'

export interface IndexLimits {
  maxFiles: number
  extensions: string[]
  filesPerSec: number | null
}

export function readIndexLimits(db: FileDb): IndexLimits {
  const maxRaw = Number(metaGet(db, 'index.maxFiles'))
  const maxFiles = metaGet(db, 'index.maxFiles') == null ? INDEX_MAX_FILES : clampMaxFiles(maxRaw)
  const stored = metaGet(db, 'index.extensions')
  const extensions = stored == null ? [...DEFAULT_INDEX_EXTENSIONS] : parseExtensions(stored)
  const rate = Number(metaGet(db, 'index.filesPerSec'))
  return { maxFiles, extensions, filesPerSec: Number.isFinite(rate) && rate > 0 ? rate : null }
}

export function writeIndexLimits(db: FileDb, patch: { maxFiles: number; extensions: string }): IndexLimits {
  const maxFiles = clampMaxFiles(patch.maxFiles)
  const extensions = parseExtensions(patch.extensions)
  metaSet(db, 'index.maxFiles', String(maxFiles))
  metaSet(db, 'index.extensions', extensions.join(','))
  return readIndexLimits(db)
}

export function rememberThroughput(db: FileDb, filesPerSec: number): void {
  if (!Number.isFinite(filesPerSec) || filesPerSec <= 0) return
  metaSet(db, 'index.filesPerSec', String(filesPerSec))
}

export { filesPerSecond }
