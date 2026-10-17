import { copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { sha256File } from './pack-verify.js'

export interface AdoptRow {
  id: string
  role: string
  file: string
  sha256: string
  size_bytes: number
}

export interface AdoptedFile {
  id: string
  moved: boolean
}

/** Chat files the website can drop in Downloads. Names stay a single .gguf file. */
export function adoptRows(models: readonly AdoptRow[]): AdoptRow[] {
  return models.filter((row) => row.role === 'chat' && safeGgufName(row.file) && /^[a-f0-9]{64}$/.test(row.sha256) && row.size_bytes > 0)
}

function safeGgufName(file: string): boolean {
  return Boolean(file) && file === basename(file) && !file.includes('..') && file.toLowerCase().endsWith('.gguf')
}

/**
 * Hash one local file and, when it matches a registry row, move it into the models folder.
 * `name` requires the Downloads filename. `hash` accepts a deep-link path with any name.
 * A failed check leaves the file where it was.
 */
export async function adoptVerified(
  source: string,
  destDir: string,
  rows: readonly AdoptRow[],
  match: 'name' | 'hash',
  seen?: Map<string, string>,
): Promise<AdoptedFile | null> {
  if (!source || !isAbsolute(source)) return null
  let info: { isFile(): boolean; size: number; mtimeMs: number }
  try {
    info = await stat(source)
  } catch {
    return null
  }
  if (!info.isFile() || info.size <= 0) return null
  const stamp = `${info.size}:${info.mtimeMs}`
  if (seen?.get(source) === stamp) return null
  const sized = rows.filter((row) => row.size_bytes === info.size && safeGgufName(row.file))
  const pool = match === 'name' ? sized.filter((row) => row.file === basename(source)) : sized
  if (pool.length === 0) {
    seen?.set(source, stamp)
    return null
  }
  let digest = ''
  try {
    digest = await sha256File(source)
  } catch {
    return null
  }
  const row = pool.find((item) => item.sha256 === digest)
  if (!row) {
    seen?.set(source, stamp)
    return null
  }
  await mkdir(destDir, { recursive: true })
  const dest = join(destDir, row.file)
  if (resolve(source) === resolve(dest)) return { id: row.id, moved: false }
  let existing: { isFile(): boolean; size: number } | null = null
  try { existing = await stat(dest) } catch { existing = null }
  if (existing?.isFile() && existing.size === row.size_bytes) return { id: row.id, moved: false }
  try {
    await rename(source, dest)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw error
    await copyFile(source, dest)
    await unlink(source)
  }
  seen?.delete(source)
  return { id: row.id, moved: true }
}

/** Look only at registry filenames in one folder. Other files are not hashed. */
export async function adoptFromFolder(
  folder: string,
  destDir: string,
  rows: readonly AdoptRow[],
  seen?: Map<string, string>,
): Promise<AdoptedFile[]> {
  if (!folder) return []
  let names: string[]
  try { names = await readdir(folder) } catch { return [] }
  const wanted = new Set(rows.map((row) => row.file))
  const found: AdoptedFile[] = []
  for (const name of names) {
    if (!wanted.has(name)) continue
    const result = await adoptVerified(join(folder, name), destDir, rows, 'name', seen)
    if (result) found.push(result)
  }
  return found
}
