/**
 * OCR utility process. tesseract.js worker_threads stall inside the Electron main
 * process after pdf.js has loaded, so recognition runs here instead.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createWorker, type Worker } from 'tesseract.js'

interface OcrRequest {
  id: number
  image: Uint8Array
  tessdataDir: string
  cacheDir: string
  workerPath: string
}

interface OcrReply {
  id: number
  text?: string
  confidence?: number
  error?: string
}

interface ParentPort {
  on(event: 'message', listener: (event: { data: OcrRequest }) => void): void
  postMessage(message: OcrReply): void
}

const parent = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
if (!parent) throw new Error('OCR runner must be started with utilityProcess.fork')

let engine: Promise<Worker> | null = null
let engineKey = ''

/** tesseract.js fetches lang paths unless the cache already has the files. Electron is not "node". */
function seedCache(tessdataDir: string, cacheDir: string): void {
  mkdirSync(cacheDir, { recursive: true })
  for (const lang of ['eng', 'hin']) {
    const src = join(tessdataDir, `${lang}.traineddata`)
    const dest = join(cacheDir, `${lang}.traineddata`)
    if (existsSync(src) && !existsSync(dest)) copyFileSync(src, dest)
  }
}

function shared(req: OcrRequest): Promise<Worker> {
  const key = `${req.tessdataDir}\n${req.cacheDir}\n${req.workerPath}`
  if (!engine || engineKey !== key) {
    engineKey = key
    const previous = engine
    engine = (async () => {
      if (previous) {
        try { await (await previous).terminate() } catch { /* replaced */ }
      }
      seedCache(req.tessdataDir, req.cacheDir)
      return Promise.race([
        createWorker('eng+hin', 1, {
          workerPath: req.workerPath,
          langPath: req.tessdataDir,
          cachePath: req.cacheDir,
          gzip: false,
          errorHandler: (err: unknown) => { console.error('[surf-ocr]', err) },
        }),
        new Promise<Worker>((_, reject) => {
          setTimeout(() => reject(new Error('OCR engine did not start')), 45_000)
        }),
      ])
    })()
  }
  return engine
}

parent.on('message', (event) => {
  const req = event.data
  void (async () => {
    try {
      const worker = await shared(req)
      const result = await worker.recognize(Buffer.from(req.image.buffer, req.image.byteOffset, req.image.byteLength))
      parent.postMessage({
        id: req.id,
        text: (result.data.text ?? '').trim(),
        confidence: result.data.confidence ?? 0,
      })
    } catch (error) {
      engine = null
      parent.postMessage({ id: req.id, error: (error as Error).message || 'OCR failed' })
    }
  })()
})
