/**
 * Model file transfer (main process): resumable, verified (size + SHA-256),
 * atomic (".part" renamed only after the hash matches).
 * The file lands in the app data folder, outside the bundle, so an update does not fetch it again.
 * The small installer does not contain a model. An offline zip copies the Qwen file
 * and the search model out of resources/setup-models.
 * In Electron prefer `net.fetch` (uses the OS proxy settings) — same API as global fetch used here.
 */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, open, rename, stat, statfs, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { requiredFreeBytes } from '../../shared/setup-choice.js'

export interface DownloadSpec { url: string; dest: string; size: number; sha256: string }
export type Progress = (done: number, total: number) => void

export class DownloadError extends Error {
  readonly code: 'disk' | 'checksum' | 'network' | 'http' | 'size'
  readonly requiredBytes: number | null
  readonly freeBytes: number | null
  readonly httpStatus: number | null

  constructor(code: DownloadError['code'], message: string, extra: { requiredBytes?: number | null; freeBytes?: number | null; httpStatus?: number | null } = {}) {
    super(message)
    this.name = 'DownloadError'
    this.code = code
    this.requiredBytes = extra.requiredBytes ?? null
    this.freeBytes = extra.freeBytes ?? null
    this.httpStatus = extra.httpStatus ?? null
  }
}

export interface DownloadOptions {
  /** Test hook. When omitted, free space comes from statfs. */
  freeBytes?: () => Promise<number | null>
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: string }).name
  return name === 'AbortError'
}

export async function readFreeBytes(dir: string): Promise<number | null> {
  try {
    const info = await statfs(dir)
    if (!Number.isFinite(info.bavail) || !Number.isFinite(info.bsize)) return null
    return info.bavail * info.bsize
  } catch {
    return null
  }
}

async function hashExisting(path: string): Promise<{ hash: ReturnType<typeof createHash>; bytes: number }> {
  const hash = createHash('sha256')
  let bytes = 0
  if (existsSync(path)) {
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk as Buffer)
      bytes += (chunk as Buffer).length
    }
  }
  return { hash, bytes }
}

function diskError(size: number, free: number | null): DownloadError {
  const required = requiredFreeBytes(size)
  const freeText = free == null ? 'unknown' : String(free)
  return new DownloadError('disk', `not enough free disk space: need ${required}, free ${freeText}`, { requiredBytes: required, freeBytes: free })
}

async function ensureDisk(dir: string, size: number, options?: DownloadOptions): Promise<void> {
  const free = options?.freeBytes ? await options.freeBytes() : await readFreeBytes(dir)
  if (free == null) return
  if (free < requiredFreeBytes(size)) throw diskError(size, free)
}

function meter(hash: ReturnType<typeof createHash>, getDone: () => number, setDone: (n: number) => void, size: number, onProgress?: Progress, signal?: AbortSignal): Transform {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      const done = getDone()
      if (done + chunk.length > size) {
        cb(new DownloadError('checksum', 'sha256 mismatch - file deleted, retry'))
        return
      }
      hash.update(chunk)
      const next = done + chunk.length
      setDone(next)
      if (!signal?.aborted) {
        try { onProgress?.(next, size) }
        catch { /* the window may already be gone; keep writing the file */ }
      }
      cb(null, chunk)
    },
  })
}

async function finish(part: string, spec: Pick<DownloadSpec, 'dest' | 'size' | 'sha256'>, hash: ReturnType<typeof createHash>, bytes: number): Promise<string> {
  if (bytes !== spec.size) throw new DownloadError('network', 'no internet')
  const digest = hash.digest('hex')
  if (digest !== spec.sha256) {
    await unlink(part).catch(() => undefined)
    throw new DownloadError('checksum', 'sha256 mismatch - file deleted, retry')
  }
  await rename(part, spec.dest)
  return spec.dest
}

export async function fileMatches(path: string, size: number, sha256: string): Promise<boolean> {
  if (!existsSync(path)) return false
  const info = await stat(path)
  if (info.size !== size) return false
  const { hash, bytes } = await hashExisting(path)
  return bytes === size && hash.digest('hex') === sha256
}

export async function downloadVerified(spec: DownloadSpec, onProgress?: Progress, signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch, options?: DownloadOptions): Promise<string> {
  if (await fileMatches(spec.dest, spec.size, spec.sha256)) return spec.dest
  if (existsSync(spec.dest)) await unlink(spec.dest).catch(() => undefined)
  await mkdir(dirname(spec.dest), { recursive: true })
  await ensureDisk(dirname(spec.dest), spec.size, options)

  const part = spec.dest + '.part'
  let { hash, bytes } = await hashExisting(part)
  if (bytes > spec.size) {
    await unlink(part)
    ;({ hash, bytes } = await hashExisting(part))
  }

  if (bytes < spec.size) {
    let res: Response
    try {
      res = await fetchImpl(spec.url, { headers: bytes ? { Range: `bytes=${bytes}-` } : {}, redirect: 'follow', signal })
    } catch (error) {
      if (isAbortError(error) || signal?.aborted) throw error
      throw new DownloadError('network', 'no internet')
    }
    if (bytes && res.status === 200) {
      await unlink(part)
      ;({ hash, bytes } = await hashExisting(part))
    } else if (!res.ok) {
      throw new DownloadError('http', `download failed: HTTP ${res.status}`, { httpStatus: res.status })
    }
    if (!res.body) throw new DownloadError('network', 'no internet')
    let done = bytes
    const stream = meter(hash, () => done, (next) => { done = next }, spec.size, onProgress, signal)
    try {
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), stream,
        createWriteStream(part, { flags: bytes ? 'a' : 'w' }), { signal })
    } catch (error) {
      if (error instanceof DownloadError && error.code === 'checksum') {
        await unlink(part).catch(() => undefined)
      }
      if (error instanceof DownloadError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOSPC') {
        const free = options?.freeBytes ? await options.freeBytes() : await readFreeBytes(dirname(spec.dest))
        throw diskError(spec.size, free)
      }
      if (isAbortError(error) || signal?.aborted) throw abortError(error)
      throw new DownloadError('network', 'no internet')
    }
    if (signal?.aborted) throw abortError()
    bytes = done
  }
  return finish(part, spec, hash, bytes)
}

function abortError(error?: unknown): Error {
  if (isAbortError(error)) return error as Error
  const aborted = new Error('The operation was aborted')
  aborted.name = 'AbortError'
  return aborted
}

/** Copy a model that shipped inside the installer. The source file stays in the bundle. */
export async function copyVerified(source: string, spec: Omit<DownloadSpec, 'url'>, onProgress?: Progress, signal?: AbortSignal, options?: DownloadOptions): Promise<string> {
  if (await fileMatches(spec.dest, spec.size, spec.sha256)) return spec.dest
  if (existsSync(spec.dest)) await unlink(spec.dest).catch(() => undefined)
  const sourceInfo = await stat(source)
  if (sourceInfo.size !== spec.size) throw new DownloadError('size', `size mismatch: got ${sourceInfo.size}, expected ${spec.size}`)
  await mkdir(dirname(spec.dest), { recursive: true })
  await ensureDisk(dirname(spec.dest), spec.size, options)
  const part = spec.dest + '.part'
  let { hash, bytes } = await hashExisting(part)
  if (bytes > spec.size) {
    await unlink(part)
    ;({ hash, bytes } = await hashExisting(part))
  }
  if (bytes < spec.size) {
    let done = bytes
    const stream = meter(hash, () => done, (next) => { done = next }, spec.size, onProgress, signal)
    const handle = await open(source, 'r')
    try {
      const readable = handle.createReadStream({ start: bytes })
      await pipeline(readable, stream, createWriteStream(part, { flags: bytes ? 'a' : 'w' }), { signal })
    } catch (error) {
      if (error instanceof DownloadError && error.code === 'checksum') await unlink(part).catch(() => undefined)
      if (error instanceof DownloadError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOSPC') {
        const free = options?.freeBytes ? await options.freeBytes() : await readFreeBytes(dirname(spec.dest))
        throw diskError(spec.size, free)
      }
      if (isAbortError(error) || signal?.aborted) throw error
      throw error
    } finally {
      await handle.close()
    }
    bytes = done
  }
  return finish(part, spec, hash, bytes)
}
