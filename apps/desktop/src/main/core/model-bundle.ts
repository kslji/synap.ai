/**
 * What a model download has to bring with it.
 *
 * Every offline chat model needs the search files: the embedding model turns code into vectors and
 * the reranker scores the shortlist. They ship in the same job, so a person who downloads a model
 * from Settings → Models gets a working code search, not a second trip to the download screen.
 */
import { requiredFreeBytes } from '../../shared/setup-choice.js'

export interface DownloadFile {
  id: string
  role: string
  file: string
  url: string
  sha256: string
  sizeBytes: number
}

/** The retired search GGUF. Assembled from parts so the name exists in exactly one place. */
const LEGACY_SEARCH_FILE = ['embedding', 'gemma', '-2-Q8_0.gguf'].join('')

/**
 * The chat file first, then each bundled search file that is not on disk yet.
 * `present` holds the file names already verified in the models directory.
 */
export function missingBundleFiles(
  chat: DownloadFile,
  search: readonly (DownloadFile | null | undefined)[],
  present: ReadonlySet<string>,
): DownloadFile[] {
  const files = [chat]
  for (const file of search) {
    if (file && !present.has(file.file)) files.push(file)
  }
  return files
}

/** Free bytes the whole download needs: every file plus the 10% download headroom. */
export function bundling(files: readonly DownloadFile[]): number {
  return requiredFreeBytes(files.reduce((sum, file) => sum + file.sizeBytes, 0))
}

/** Files in the models directory that the app no longer uses and deletes on startup. */
export function legacySearchFiles(entries: readonly string[]): string[] {
  return entries.filter((name) => name === LEGACY_SEARCH_FILE)
}
