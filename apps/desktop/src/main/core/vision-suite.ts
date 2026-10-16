/**
 * Error-screenshot fixtures. Prints measurements. Python scores the extracted text.
 * OCR uses the bundled tessdata. No model download.
 */
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWorker, type Worker } from 'tesseract.js'
import { extractErrorText } from './vision-ocr.js'
import { preprocessImage } from './vision-preprocess.js'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'vision-fixtures')
const tessdata = join(here, '../../../resources/tessdata')

const CASES = [
  { id: 'shot-type-error', file: 'type-error.png', needles: ['TypeError', 'map'] },
  { id: 'shot-ts-error', file: 'ts2304.png', needles: ['TS2304', 'formatName'] },
  { id: 'shot-assert', file: 'assert-error.png', needles: ['AssertionError', 'equal'] },
]

function seedCache(cacheDir: string): void {
  mkdirSync(cacheDir, { recursive: true })
  const src = join(tessdata, 'eng.traineddata')
  const dest = join(cacheDir, 'eng.traineddata')
  if (existsSync(src) && !existsSync(dest)) copyFileSync(src, dest)
}

async function recognize(worker: Worker, bytes: Buffer): Promise<string> {
  const result = await worker.recognize(bytes)
  return (result.data.text ?? '').replace(/\s+/g, ' ').trim()
}

async function main(): Promise<void> {
  if (!existsSync(join(tessdata, 'eng.traineddata'))) {
    throw new Error('tessdata is missing. Run node scripts/fetch-tessdata.mjs')
  }
  const cacheDir = join(tmpdir(), 'surf-vision-ocr')
  seedCache(cacheDir)
  const worker = await createWorker('eng', 1, {
    workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    langPath: tessdata,
    cachePath: cacheDir,
    gzip: false,
  })
  const rows: { id: string; weight: number; fields: Record<string, string | boolean> }[] = []
  try {
    for (const item of CASES) {
      const raw = readFileSync(join(fixtures, item.file))
      const prepared = await preprocessImage(raw, 'image/png')
      const text = await recognize(worker, prepared.bytes)
      const extracted = extractErrorText(text) || text
      const fields: Record<string, string | boolean> = { extracted }
      for (const needle of item.needles) {
        fields[needle] = extracted.includes(needle) || text.includes(needle)
      }
      rows.push({ id: item.id, weight: 1, fields })
    }
  } finally {
    await worker.terminate()
  }
  process.stdout.write(JSON.stringify(rows))
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
