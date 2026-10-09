/**
 * Read one file into the encrypted index. The chat orchestrator does not wait on this.
 */
import { locatorOf, chunkBlocks } from './chunker.js'
import { convertBytes, ConvertCancelled, mimeForName, readAttachment } from './convert.js'
import type { DB } from './db.js'
import {
  addBytes,
  attachmentPath,
  fileById,
  jobState,
  markDone,
  markFailed,
  markProgress,
  saveChunks,
  type ClaimedJob,
} from './library-store.js'
import type { LibraryFile } from './ipc-contract.js'

export interface IngestDeps {
  db: DB
  root: string
  tessdataDir: string
  tessCacheDir: string
  embed(docs: { title?: string | null; text: string }[]): Promise<Float32Array[]>
  caption?: (png: Buffer) => Promise<string | null>
  onFile?: (file: LibraryFile) => void
}

export function publish(deps: IngestDeps, attachmentId: string): void {
  const file = fileById(deps.db, attachmentId)
  if (file) deps.onFile?.(file)
}

export async function runClaimedJob(deps: IngestDeps, job: ClaimedJob): Promise<void> {
  const stored = attachmentPath(deps.db, job.attachmentId, deps.root)
  if (!stored) {
    markFailed(deps.db, job.id, job.attachmentId, 'The file is no longer on disk.')
    publish(deps, job.attachmentId)
    return
  }
  try {
    const { bytes } = await readAttachment(stored.abs)
    if (jobState(deps.db, job.id) === 'cancelled') return
    const blocks = await convertBytes(stored.name, bytes, {
      tessdataDir: deps.tessdataDir,
      tessCacheDir: deps.tessCacheDir,
      caption: deps.caption,
      cancelled: () => jobState(deps.db, job.id) === 'cancelled',
      onProgress: (ratio, stage) => {
        markProgress(deps.db, job.id, Math.min(0.7, ratio), stage)
        publish(deps, job.attachmentId)
      },
    })
    if (jobState(deps.db, job.id) === 'cancelled') return
    markProgress(deps.db, job.id, 0.74, 'Splitting into passages')
    const chunks = chunkBlocks(blocks)
    if (!chunks.length) throw new Error('No text found in this file.')
    markProgress(deps.db, job.id, 0.8, 'Embedding')
    publish(deps, job.attachmentId)
    const vectors = await deps.embed(chunks.map((chunk) => ({
      title: [stored.name, locatorOf(chunk)].filter(Boolean).join(' '),
      text: chunk.text,
    })))
    if (jobState(deps.db, job.id) === 'cancelled') return
    saveChunks(deps.db, job.attachmentId, chunks, vectors)
    markDone(deps.db, job.id)
  } catch (error) {
    if (error instanceof ConvertCancelled || jobState(deps.db, job.id) === 'cancelled') return
    markFailed(deps.db, job.id, job.attachmentId, (error as Error).message || 'Could not read this file.')
  }
  publish(deps, job.attachmentId)
}

export async function indexFile(deps: IngestDeps, sourcePath: string, conversationId: string | null): Promise<LibraryFile> {
  const { bytes, name } = await readAttachment(sourcePath)
  const mime = mimeForName(name)
  if (!mime) throw new Error('Unsupported file.')
  const added = addBytes(deps.db, deps.root, name, mime, bytes, conversationId)
  publish(deps, added.attachmentId)
  if (!added.jobId) {
    const file = fileById(deps.db, added.attachmentId)
    if (!file) throw new Error('Could not save that file.')
    return file
  }
  await runClaimedJob(deps, { id: added.jobId, attachmentId: added.attachmentId })
  const file = fileById(deps.db, added.attachmentId)
  if (!file) throw new Error('Could not save that file.')
  if (file.status === 'failed') throw new Error(file.error || 'Could not read this file.')
  return file
}
