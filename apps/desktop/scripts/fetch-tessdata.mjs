#!/usr/bin/env node
/**
 * Bundle Tesseract language data so OCR works offline after install.
 * eng + hin, the fast LSTM models tesseract.js 5 loads (@tesseract.js-data 4.0.0).
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { fetchDownload, httpFailure, withDownloadRetry } from './http-download.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'tessdata')
mkdirSync(root, { recursive: true })

const files = [
  ['eng', 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0/eng.traineddata.gz'],
  ['hin', 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/hin@1.0.0/4.0.0/hin.traineddata.gz'],
]

for (const [lang, url] of files) {
  const dest = join(root, `${lang}.traineddata`)
  if (existsSync(dest) && statSync(dest).size > 100_000) {
    console.log('keep', dest)
    continue
  }
  console.log('get', lang)
  const part = `${dest}.part`
  await withDownloadRetry(async () => {
    const res = await fetchDownload(url)
    if (!res.ok || !res.body) throw httpFailure(url, res.status)
    try {
      await pipeline(res.body, createGunzip(), createWriteStream(part))
    } catch (error) {
      try { unlinkSync(part) } catch { /* nothing written yet */ }
      throw error
    }
  })
  renameSync(part, dest)
  console.log('wrote', dest, statSync(dest).size)
}
