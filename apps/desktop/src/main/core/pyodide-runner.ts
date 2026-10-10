/**
 * Python runs in Pyodide inside a worker. The wasm is loaded on the first run.
 * If the bundled files are missing, they are downloaded into a local cache.
 * The worker has a time limit and a memory cap, and user code cannot use the network.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { RunResult } from './code-tools.js'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))

export const PYODIDE_VERSION = '0.28.2'
export const PYODIDE_MEMORY_MB = 768
const PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json', 'package.json']

export function bundledPyodideDir(): string | null {
  try {
    return dirname(require.resolve('pyodide/package.json'))
  } catch {
    return null
  }
}

export function pyodideCdn(version = PYODIDE_VERSION): string {
  return `https://cdn.jsdelivr.net/pyodide/v${version}/full/`
}

export async function ensurePyodide(cacheDir: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const bundled = bundledPyodideDir()
  if (bundled && existsSync(join(bundled, 'pyodide.asm.wasm'))) return bundled
  mkdirSync(cacheDir, { recursive: true })
  const base = pyodideCdn()
  for (const name of PYODIDE_FILES) {
    const dest = join(cacheDir, name)
    if (existsSync(dest)) continue
    const res = await fetchImpl(`${base}${name}`)
    if (!res.ok) throw new Error(`Pyodide download failed for ${name} (${res.status}).`)
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  }
  return cacheDir
}

function workerFile(): string {
  const candidates = [
    join(HERE, 'pyodide-worker.mjs'),
    join(HERE, '../pyodide-worker.mjs'),
    join(HERE, 'pyodide-worker.js'),
  ]
  return candidates.find((file) => existsSync(file)) ?? candidates[0]
}

export async function runPython(code: string, opts?: { runTimeoutMs?: number; loadTimeoutMs?: number; cacheDir?: string; fetchImpl?: typeof fetch }): Promise<RunResult> {
  const runTimeoutMs = opts?.runTimeoutMs ?? 1500
  const loadTimeoutMs = opts?.loadTimeoutMs ?? 60_000
  let indexURL = ''
  try {
    indexURL = await ensurePyodide(opts?.cacheDir ?? join(HERE, '.pyodide-cache'), opts?.fetchImpl)
  } catch (error) {
    return { executed: false, language: 'python', error: (error as Error).message }
  }
  const interrupt = new Uint8Array(new SharedArrayBuffer(1))
  return new Promise((resolve) => {
    const worker = new Worker(workerFile(), {
      workerData: { indexURL, interrupt },
      resourceLimits: { maxOldGenerationSizeMb: PYODIDE_MEMORY_MB },
    })
    let settled = false
    let runTimer: NodeJS.Timeout | undefined
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      if (runTimer) clearTimeout(runTimer)
      clearTimeout(loadTimer)
      void worker.terminate()
      resolve(result)
    }
    const loadTimer = setTimeout(() => finish({ executed: false, language: 'python', error: 'timed out' }), loadTimeoutMs)
    worker.once('message', (message: { ready?: boolean }) => {
      if (!message.ready) return
      clearTimeout(loadTimer)
      runTimer = setTimeout(() => {
        interrupt[0] = 2
        setTimeout(() => finish({ executed: false, language: 'python', error: 'timed out' }), 400)
      }, runTimeoutMs)
      worker.on('message', (next: { ok?: boolean; result?: string; error?: string }) => {
        if (next.ok) finish({ executed: true, language: 'python', result: next.result ?? '' })
        else finish({ executed: false, language: 'python', error: next.error ?? 'failed' })
      })
      worker.postMessage({ code })
    })
    worker.once('error', (error) => finish({ executed: false, language: 'python', error: error.message }))
  })
}
