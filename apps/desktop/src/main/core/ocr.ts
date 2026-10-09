/**
 * On-device OCR. tesseract.js runs a WASM core in a worker thread.
 * Language files are bundled (scripts/fetch-tessdata.mjs), not downloaded at first use.
 */
import { createRequire } from 'node:module'
import { createWorker, type Worker } from 'tesseract.js'

const require = createRequire(import.meta.url)

export function asarUnpacked(filePath: string): string {
  return filePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

let workerKey = ''
let workerPromise: Promise<Worker> | null = null

export function tesseractWorkerPath(): string {
  return asarUnpacked(require.resolve('tesseract.js/src/worker-script/node/index.js'))
}

export async function recognizeImage(image: Buffer, tessdataDir: string, cacheDir: string): Promise<{ text: string; confidence: number }> {
  const worker = await sharedWorker(tessdataDir, cacheDir)
  const result = await worker.recognize(image)
  return { text: (result.data.text ?? '').trim(), confidence: result.data.confidence ?? 0 }
}

async function sharedWorker(tessdataDir: string, cacheDir: string): Promise<Worker> {
  const key = `${tessdataDir}\n${cacheDir}`
  if (!workerPromise || workerKey !== key) {
    workerKey = key
    workerPromise = createWorker('eng+hin', 1, {
      workerPath: tesseractWorkerPath(),
      langPath: tessdataDir,
      cachePath: cacheDir,
      gzip: false,
    })
  }
  try {
    return await workerPromise
  } catch (error) {
    workerPromise = null
    throw error
  }
}

export async function shutdownOcr(): Promise<void> {
  const pending = workerPromise
  workerPromise = null
  if (!pending) return
  try {
    const worker = await pending
    await worker.terminate()
  } catch { /* already gone */ }
}
