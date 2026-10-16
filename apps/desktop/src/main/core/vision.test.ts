import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { LlamaServer } from './sidecar-manager.js'
import { captureAfterConsent, captureAllowed, memoryShot, saveAllowed } from './vision/capture.js'
import { diffImages, describeDiff } from './vision/compare.js'
import { classifyShotUse, imagesForAgent, mockupBlock } from './vision/intent.js'
import { extractErrorLines, isTextHeavy, ocrInsteadOfModel } from './vision/ocr-fallback.js'
import { qwenVisionOffer, screenshotStorageLabel, visionOfferMessage } from './vision/offer.js'
import { exifPresent, jpegWithoutExif, preprocessImage, sniffImage, targetSize } from './vision/preprocess.js'
import { mmprojServerArgs, nextVisionAttempt, runtimeSupportsMmproj, visionLoadDecision } from './vision/runtime.js'
import { prepareCodeVision } from './vision/service.js'

const QWEN2 = { modelSizeBytes: 1_574_961_408, mmprojSizeBytes: 668_227_264, minRamGb: 4 }
const QWEN4 = { modelSizeBytes: 3_525_956_768, mmprojSizeBytes: 672_423_616, minRamGb: 16 }
const QWEN9 = { modelSizeBytes: 7_458_301_152, mmprojSizeBytes: 918_166_080, minRamGb: 32 }

function png(width: number, height: number, paint: (ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>) => void): Buffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  paint(ctx)
  return canvas.toBuffer('image/png')
}

function jpeg(width: number, height: number): Buffer {
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#224488'
  ctx.fillRect(0, 0, width, height)
  return canvas.toBuffer('image/jpeg')
}

test('resize keeps aspect ratio and the long edge cap', () => {
  assert.deepEqual(targetSize(1600, 800, 1024), { width: 1024, height: 512 })
  assert.deepEqual(targetSize(800, 1600, 1024), { width: 512, height: 1024 })
  assert.deepEqual(targetSize(2000, 1, 1024), { width: 1024, height: 1 })
  assert.deepEqual(targetSize(40, 20, 1024), { width: 40, height: 20 })
})

test('preprocessing downscales, strips EXIF, and accepts png, jpeg, and webp', async () => {
  const wide = png(1600, 800, (ctx) => {
    ctx.fillStyle = '#cc3333'
    ctx.fillRect(0, 0, 800, 800)
  })
  const scaled = await preprocessImage(wide)
  assert.equal(scaled.width, 1024)
  assert.equal(scaled.height, 512)
  assert.equal(scaled.sourceMime, 'image/png')
  assert.ok(sniffImage(scaled.bytes) === 'image/png' || sniffImage(scaled.bytes) === 'image/jpeg')
  assert.equal(exifPresent(scaled.bytes), false)

  const raw = jpeg(48, 32)
  const payload = Buffer.from('Exif\u0000\u0000GPS-SECRET', 'latin1')
  const segment = Buffer.alloc(4 + payload.length)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(2 + payload.length, 2)
  payload.copy(segment, 4)
  const withExif = Buffer.concat([raw.subarray(0, 2), segment, raw.subarray(2)])
  assert.equal(exifPresent(withExif), true)
  const stripped = jpegWithoutExif(withExif)
  assert.equal(stripped.stripped, true)
  assert.equal(exifPresent(stripped.bytes), false)
  const cleaned = await preprocessImage(withExif, { maxEdge: 1024, maxBytes: 1_200_000 })
  assert.equal(cleaned.strippedExif, true)
  assert.equal(exifPresent(cleaned.bytes), false)
  assert.equal(cleaned.sourceMime, 'image/jpeg')

  const header = Buffer.alloc(16)
  header.write('RIFF', 0, 'ascii')
  header.write('WEBP', 8, 'ascii')
  assert.equal(sniffImage(header), 'image/webp')
  const canvas = createCanvas(8, 8)
  canvas.getContext('2d').fillRect(0, 0, 8, 8)
  let webp: Buffer | null = null
  try {
    webp = (canvas as unknown as { toBuffer(mime: string): Buffer }).toBuffer('image/webp')
  } catch {
    webp = null
  }
  if (webp && sniffImage(webp) === 'image/webp') {
    const converted = await preprocessImage(webp)
    assert.ok(converted.mime === 'image/png' || converted.mime === 'image/jpeg')
    assert.equal(converted.sourceMime, 'image/webp')
  }
})

test('a byte cap shrinks the screenshot further', async () => {
  const noisy = png(280, 200, (ctx) => {
    const image = ctx.getImageData(0, 0, 280, 200)
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = (i * 17) % 256
      image.data[i + 1] = (i * 31) % 256
      image.data[i + 2] = (i * 13) % 256
      image.data[i + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
  })
  const capped = await preprocessImage(noisy, { maxEdge: 256, maxBytes: 4_000 })
  assert.ok(capped.bytes.length <= 4_000)
  assert.ok(Math.max(capped.width, capped.height) <= 256)
  assert.ok(capped.width >= 1 && capped.height >= 1)
})

test('the Qwen screenshot add-on is offered only when the installed model and mmproj fit', () => {
  const base = { family: 'qwen3.5', agents: ['code'], installed: true, hasMmproj: true, totalRamGb: 8, ...QWEN2 }
  const offered = qwenVisionOffer(base)
  assert.equal(offered.offer, true)
  assert.equal(offered.autoDownload, false)
  assert.equal(qwenVisionOffer({ ...base, totalRamGb: 4 }).reason, 'ram')
  assert.equal(qwenVisionOffer({ ...base, installed: false }).reason, 'not-installed')
  assert.equal(qwenVisionOffer({ ...base, family: 'gemma4', totalRamGb: 32 }).reason, 'not-qwen')
  assert.equal(qwenVisionOffer({ ...base, agents: ['general'] }).reason, 'not-code')
  assert.equal(qwenVisionOffer({ ...base, ...QWEN4, totalRamGb: 16 }).reason, 'ram')
  assert.equal(qwenVisionOffer({ ...base, ...QWEN4, totalRamGb: 32 }).offer, true)
  assert.equal(qwenVisionOffer({ ...base, ...QWEN9, totalRamGb: 32 }).reason, 'ram')
  assert.equal(qwenVisionOffer({ ...base, totalRamGb: 8 }).autoDownload, false)
  assert.match(visionOfferMessage('ram'), /room/)
  assert.equal(
    screenshotStorageLabel('qwen3.5-2b-q6_k--mmproj-F16.gguf', [{
      id: 'qwen3.5-2b-q6_k',
      label: 'Qwen3.5 2B',
      file: 'Qwen3.5-2B-Q6_K.gguf',
      mmprojFile: 'mmproj-F16.gguf',
    }]),
    'Qwen3.5 2B screenshot add-on',
  )
})

test('capture runs only after an explicit action and OS permission, and stays in memory', async () => {
  let grabs = 0
  let asks = 0
  const grab = async () => {
    grabs += 1
    return Buffer.from('png')
  }
  const ask = async () => {
    asks += 1
    return false
  }
  await assert.rejects(() => captureAfterConsent({ explicitAction: false, platform: 'linux', permission: 'granted', grab }))
  assert.equal(grabs, 0)
  await assert.rejects(() => captureAfterConsent({ explicitAction: true, platform: 'darwin', permission: 'denied', requestPermission: ask, grab }))
  assert.equal(grabs, 0)
  assert.equal(asks, 0)
  await assert.rejects(() => captureAfterConsent({ explicitAction: true, platform: 'darwin', permission: 'prompt', requestPermission: ask, grab }))
  assert.equal(asks, 1)
  assert.equal(grabs, 0)
  const shot = await captureAfterConsent({ explicitAction: true, platform: 'linux', permission: 'unknown', grab })
  assert.equal(grabs, 1)
  assert.equal(shot.toString(), 'png')
  const held = memoryShot(shot)
  assert.equal(held.savedPath, null)
  assert.equal(saveAllowed(false), false)
  assert.equal(saveAllowed(true), true)
  assert.deepEqual(captureAllowed({ explicitAction: false, permission: 'granted' }), { ok: false, reason: 'no-action' })
  assert.deepEqual(captureAllowed({ explicitAction: true, permission: 'denied' }), { ok: false, reason: 'permission' })
  assert.deepEqual(captureAllowed({ explicitAction: true, permission: 'granted' }), { ok: true })
})

test('mmproj loads only when the runtime supports it, and falls back when the flag is missing', () => {
  assert.equal(runtimeSupportsMmproj('usage: llama-server --mmproj FNAME\nlibmtmd loaded'), true)
  assert.equal(runtimeSupportsMmproj('llama-server --help\nno vision'), false)
  assert.deepEqual(mmprojServerArgs(false, 'proj.gguf'), [])
  assert.deepEqual(mmprojServerArgs(true, ''), [])
  assert.deepEqual(mmprojServerArgs(true, 'proj.gguf'), ['--mmproj', 'proj.gguf'])
  assert.equal(visionLoadDecision({ runtimeSupports: false, installed: true, ramOk: true, blocked: false }).reason, 'runtime')
  assert.equal(visionLoadDecision({ runtimeSupports: true, installed: false, ramOk: true, blocked: false }).reason, 'missing')
  assert.equal(visionLoadDecision({ runtimeSupports: true, installed: true, ramOk: false, blocked: false }).reason, 'ram')
  assert.equal(visionLoadDecision({ runtimeSupports: true, installed: true, ramOk: true, blocked: true }).load, false)
  assert.deepEqual(nextVisionAttempt({ mmproj: 'proj.gguf', draft: 'draft.gguf' }), { mmproj: 'proj.gguf', draft: '' })
  assert.deepEqual(nextVisionAttempt({ mmproj: 'proj.gguf', draft: '' }), { mmproj: '', draft: '' })
  assert.equal(nextVisionAttempt({ mmproj: '', draft: '' }), null)
  const withProj = new LlamaServer({ binPath: 'llama-server', modelPath: 'model.gguf', mmprojPath: 'proj.gguf', ctx: 8192 })
  const plain = new LlamaServer({ binPath: 'llama-server', modelPath: 'model.gguf', ctx: 8192 })
  assert.ok(withProj.args().includes('--mmproj'))
  assert.equal(plain.args().includes('--mmproj'), false)
})

test('OCR is the fallback when mmproj is missing or the screenshot is text-heavy', () => {
  assert.equal(ocrInsteadOfModel({ mmprojAvailable: false, textHeavy: false }), true)
  assert.equal(ocrInsteadOfModel({ mmprojAvailable: true, textHeavy: true }), true)
  assert.equal(ocrInsteadOfModel({ mmprojAvailable: true, textHeavy: false }), false)
  const error = 'TypeError: x is not a function\n    at render (App.tsx:12:5)'
  assert.equal(isTextHeavy(error, 80), true)
  assert.deepEqual(extractErrorLines(error), ['TypeError: x is not a function', 'at render (App.tsx:12:5)'])
  assert.deepEqual(extractErrorLines('AssertionError: expected 1 to equal 2'), ['AssertionError: expected 1 to equal 2'])
  assert.equal(isTextHeavy('Save', 90), false)
  assert.equal(imagesForAgent('general'), false)
  assert.equal(imagesForAgent('assistant'), false)
  assert.equal(imagesForAgent('code'), true)
})

test('an error screenshot feeds the fix loop, a mockup stays behind Ask or Auto, and a comparison is measured', async () => {
  const image = png(80, 40, (ctx) => {
    ctx.fillStyle = '#111111'
    ctx.fillRect(4, 4, 20, 20)
  })
  let described = 0
  const error = await prepareCodeVision({
    userText: 'fix this error',
    images: [image],
    mmprojAvailable: false,
    family: 'qwen3.5',
    ocr: async () => ({ text: 'TypeError: x is not a function', confidence: 88 }),
    describe: async () => {
      described += 1
      return 'should not run'
    },
  })
  assert.equal(error.use, 'error')
  assert.equal(error.answerOnly, null)
  assert.match(error.task, /TypeError: x is not a function/)
  assert.match(error.task, /Fix this error/)
  assert.equal(described, 0)

  const mockup = await prepareCodeVision({
    userText: 'implement the component from this mockup',
    images: [image],
    mmprojAvailable: true,
    family: 'qwen3.5',
    ocr: async () => ({ text: 'Save', confidence: 10 }),
    describe: async () => 'A save button at the top.',
  })
  assert.equal(mockup.use, 'mockup')
  assert.equal(mockup.answerOnly, null)
  assert.match(mockup.task, /A save button at the top/)
  assert.match(mockup.task, /Ask or Auto/)
  assert.match(mockupBlock('panel'), /Do not skip approval/)

  const other = png(80, 40, (ctx) => {
    ctx.fillStyle = '#dddddd'
    ctx.fillRect(0, 0, 80, 40)
  })
  const compared = await prepareCodeVision({
    userText: 'compare this screenshot with the expected one',
    images: [image, other],
    mmprojAvailable: false,
    family: 'qwen3.5',
    ocr: async () => ({ text: 'Save', confidence: 20 }),
    describe: async () => {
      described += 1
      return 'invented 99%'
    },
  })
  assert.equal(compared.use, 'compare')
  assert.match(compared.answerOnly ?? '', /measured on this computer/)
  assert.match(compared.answerOnly ?? '', /% of pixels differ/)
  assert.equal(described, 0)
  assert.equal(classifyShotUse('adjust the component to match the expected layout', 2), 'mockup')
  const facts = await diffImages(image, image, 'Save', 'Cancel')
  assert.equal(facts.changedPercent, 0)
  assert.match(describeDiff(facts), /0% of pixels differ/)
  assert.match(describeDiff({ ...facts, onlyRight: ['Cancel'] }), /Cancel/)
})

test('tesseract reads error text from a screenshot when language data is installed', { timeout: 90_000 }, async () => {
  const tessdata = join(process.cwd(), 'resources', 'tessdata', 'eng.traineddata')
  const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']
    .find((path) => existsSync(path))
  if (!existsSync(tessdata) || !font) return
  const { GlobalFonts } = await import('@napi-rs/canvas')
  GlobalFonts.registerFromPath(font, 'VisionTest')
  const canvas = createCanvas(900, 140)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 900, 140)
  ctx.fillStyle = '#000000'
  ctx.font = '32px VisionTest'
  ctx.fillText('TypeError: x is not a function', 24, 80)
  const shot = canvas.toBuffer('image/png')
  const prepared = await preprocessImage(shot)
  const { createWorker } = await import('tesseract.js')
  const { tesseractWorkerPath } = await import('./ocr.js')
  const cache = mkdtempSync(join(tmpdir(), 'surf-ocr-'))
  const worker = await createWorker('eng', 1, {
    workerPath: tesseractWorkerPath(),
    langPath: join(process.cwd(), 'resources', 'tessdata'),
    cachePath: cache,
    gzip: false,
  })
  try {
    const result = await worker.recognize(prepared.bytes)
    const lines = extractErrorLines(result.data.text ?? '')
    assert.ok(lines.some((line) => /TypeError/.test(line) && /function/.test(line)), result.data.text)
  } finally {
    await worker.terminate()
  }
})
