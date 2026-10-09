/**
 * On-device OCR. tesseract.js runs in a utility process so a stuck WASM worker
 * cannot freeze chat. Language files are bundled (scripts/fetch-tessdata.mjs).
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { UtilityProcess } from 'electron'

const require = createRequire(import.meta.url)

export function asarUnpacked(filePath: string): string {
  return filePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

export function tesseractWorkerPath(): string {
  return asarUnpacked(require.resolve('tesseract.js/src/worker-script/node/index.js'))
}

export function ocrRunnerPath(): string {
  const beside = fileURLToPath(new URL('./ocr-runner.js', import.meta.url))
  if (existsSync(beside)) return beside
  throw new Error('OCR runner is missing. Rebuild the desktop app.')
}

interface OcrReply {
  id: number
  text?: string
  confidence?: number
  error?: string
}

interface Pending {
  resolve: (value: { text: string; confidence: number }) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

let child: UtilityProcess | null = null
let starting: Promise<UtilityProcess> | null = null
let seq = 0
const pending = new Map<number, Pending>()

function failAll(error: Error): void {
  for (const job of pending.values()) {
    clearTimeout(job.timer)
    job.reject(error)
  }
  pending.clear()
}

async function ensureChild(): Promise<UtilityProcess> {
  if (child) return child
  if (starting) return starting
  starting = (async () => {
    const { utilityProcess } = await import('electron')
    const proc = utilityProcess.fork(ocrRunnerPath(), [], { stdio: 'inherit', serviceName: 'surf-ocr' })
    proc.on('message', (message: OcrReply) => {
      const job = pending.get(message.id)
      if (!job) return
      clearTimeout(job.timer)
      pending.delete(message.id)
      if (message.error) job.reject(new Error(message.error))
      else job.resolve({ text: message.text ?? '', confidence: message.confidence ?? 0 })
    })
    proc.on('exit', (code) => {
      if (child === proc) child = null
      failAll(new Error(`OCR stopped (${code})`))
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OCR process did not start')), 15_000)
      proc.once('spawn', () => { clearTimeout(timer); resolve() })
      proc.once('exit', (code) => { clearTimeout(timer); reject(new Error(`OCR exited ${code}`)) })
    })
    child = proc
    return proc
  })()
  try {
    return await starting
  } catch (error) {
    child = null
    throw error
  } finally {
    starting = null
  }
}

export async function recognizeImage(image: Buffer, tessdataDir: string, cacheDir: string): Promise<{ text: string; confidence: number }> {
  const id = ++seq
  const proc = await ensureChild()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('OCR timed out'))
    }, 60_000)
    pending.set(id, { resolve, reject, timer })
    proc.postMessage({
      id,
      image: new Uint8Array(image),
      tessdataDir,
      cacheDir,
      workerPath: tesseractWorkerPath(),
    })
  })
}

export async function shutdownOcr(): Promise<void> {
  const proc = child
  child = null
  if (!proc) return
  proc.kill()
}
