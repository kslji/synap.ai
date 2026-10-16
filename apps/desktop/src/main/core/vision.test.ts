import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCanvas } from '@napi-rs/canvas'
import { triageTask } from './code-agent/plan.js'
import { captureScreen, imagePathsAllowed, mayCaptureScreen, saveScreenshot } from './vision-capture.js'
import { extractErrorText, isTextHeavy, ocrFallbackChoice } from './vision-ocr.js'
import { screenshotAddonOffer, screenshotStorageLabel, visionPairFits } from './vision-offer.js'
import { fitBox, preprocessImage, stripJpegExif, stripPngExif } from './vision-preprocess.js'
import { mmprojArg, runtimeSupportsMmproj, visionBlockReason, visionFallbackMessage } from './vision-runtime.js'
import { buildErrorTask, readScreenshots } from './vision-route.js'

const QWEN_2B_Q4 = { modelBytes: 1_280_835_840, mmprojBytes: 668_227_264, minRamGb: 4 }
const QWEN_2B_Q6 = { modelBytes: 1_574_961_408, mmprojBytes: 668_227_264, minRamGb: 4 }
const QWEN_9B_Q6 = { modelBytes: 7_458_301_152, mmprojBytes: 918_166_080, minRamGb: 32 }

test('vision pair uses the laptop file cap', () => {
  assert.equal(visionPairFits({ ...QWEN_2B_Q4, totalRamGb: 4 }), true)
  assert.equal(visionPairFits({ ...QWEN_2B_Q6, totalRamGb: 4 }), false)
  assert.equal(visionPairFits({ ...QWEN_2B_Q6, totalRamGb: 8 }), true)
  assert.equal(visionPairFits({ ...QWEN_9B_Q6, totalRamGb: 32 }), false)
})

test('screenshot add-on is offered only for an installed Qwen that fits, and never auto-downloads', () => {
  const fit = screenshotAddonOffer({
    family: 'qwen3.5',
    modelInstalled: true,
    ...QWEN_2B_Q4,
    mmprojInstalled: false,
    totalRamGb: 4,
    runtimeSupports: true,
  })
  assert.equal(fit.offerDownload, true)
  assert.equal(fit.autoDownload, false)
  assert.equal(fit.sizeBytes, QWEN_2B_Q4.mmprojBytes)

  const tight = screenshotAddonOffer({
    family: 'qwen3.5',
    modelInstalled: true,
    ...QWEN_2B_Q6,
    mmprojInstalled: false,
    totalRamGb: 4,
    runtimeSupports: true,
  })
  assert.equal(tight.offerDownload, false)
  assert.equal(tight.reason, 'ram')
  assert.equal(tight.autoDownload, false)

  const gemma = screenshotAddonOffer({
    family: 'gemma4',
    modelInstalled: true,
    modelBytes: 3_349_516_256,
    mmprojBytes: 986_833_664,
    minRamGb: 8,
    mmprojInstalled: false,
    totalRamGb: 32,
    runtimeSupports: true,
  })
  assert.equal(gemma.show, false)
  assert.equal(gemma.reason, 'not-qwen')

  const missingModel = screenshotAddonOffer({
    family: 'qwen3.5',
    modelInstalled: false,
    ...QWEN_2B_Q4,
    mmprojInstalled: false,
    totalRamGb: 16,
    runtimeSupports: true,
  })
  assert.equal(missingModel.offerDownload, false)
  assert.equal(missingModel.reason, 'model-missing')

  const unsupported = screenshotAddonOffer({
    family: 'qwen3.5',
    modelInstalled: true,
    ...QWEN_2B_Q4,
    mmprojInstalled: false,
    totalRamGb: 8,
    runtimeSupports: false,
  })
  assert.equal(unsupported.offerDownload, false)
  assert.equal(unsupported.reason, 'runtime')
})

test('storage labels the projector and leaves other files alone', () => {
  assert.equal(screenshotStorageLabel('qwen3.5-2b-q6_k--mmproj-F16.gguf'), 'Screenshot add-on · qwen3.5-2b-q6_k')
  assert.equal(screenshotStorageLabel('Qwen3.5-2B-Q6_K.gguf'), 'Qwen3.5-2B-Q6_K.gguf')
})

test('mmproj support is detected from llama-server help', () => {
  assert.equal(runtimeSupportsMmproj('usage: llama-server --mmproj FNAME'), true)
  assert.equal(runtimeSupportsMmproj('built with libmtmd'), true)
  assert.equal(runtimeSupportsMmproj('usage: llama-server -m model'), false)
  assert.equal(visionBlockReason({ runtimeSupports: false, mmprojInstalled: true, ramOk: true }), 'unsupported')
  assert.equal(visionBlockReason({ runtimeSupports: true, mmprojInstalled: false, ramOk: true }), 'missing')
  assert.equal(visionBlockReason({ runtimeSupports: true, mmprojInstalled: true, ramOk: false }), 'ram')
  assert.equal(mmprojArg({ path: '/models/mmproj.gguf', block: 'unsupported' }), '')
  assert.equal(mmprojArg({ path: '/models/mmproj.gguf', block: 'ok' }), '/models/mmproj.gguf')
  assert.match(visionFallbackMessage('unsupported'), /cannot load the screenshot add-on/)
  assert.match(visionFallbackMessage('missing'), /not installed/)
})

test('capture requires an explicit click and permission, and does not save on its own', async () => {
  assert.equal(mayCaptureScreen({ explicitAction: false, permission: 'granted', platform: 'darwin' }).ok, false)
  assert.equal(mayCaptureScreen({ explicitAction: true, permission: 'denied', platform: 'linux' }).ok, false)
  assert.equal(mayCaptureScreen({ explicitAction: true, permission: 'not-determined', platform: 'darwin' }).ok, false)
  assert.equal(mayCaptureScreen({ explicitAction: true, permission: 'granted', platform: 'darwin' }).ok, true)
  assert.equal(mayCaptureScreen({ explicitAction: true, permission: 'unknown', platform: 'linux' }).ok, true)

  let calls = 0
  const blocked = await captureScreen({
    explicitAction: false,
    permission: 'granted',
    platform: 'darwin',
    getSources: async () => {
      calls += 1
      return [{ png: Buffer.from('x'.repeat(64)) }]
    },
  })
  assert.equal(blocked.ok, false)
  assert.equal(calls, 0)

  const allowed = await captureScreen({
    explicitAction: true,
    permission: 'granted',
    platform: 'darwin',
    getSources: async () => [{ png: Buffer.from('x'.repeat(64)) }],
  })
  assert.equal(allowed.ok, true)

  let writes = 0
  let prompts = 0
  const quiet = await saveScreenshot({
    userSave: false,
    png: Buffer.from('png'),
    choosePath: async () => {
      prompts += 1
      return '/tmp/shot.png'
    },
    write: () => { writes += 1 },
  })
  assert.equal(quiet.saved, false)
  assert.equal(prompts, 0)
  assert.equal(writes, 0)

  const saved = await saveScreenshot({
    userSave: true,
    png: Buffer.from('png'),
    choosePath: async () => '/tmp/shot.png',
    write: () => { writes += 1 },
  })
  assert.equal(saved.saved, true)
  assert.equal(writes, 1)
  assert.deepEqual(imagePathsAllowed(false, ['/tmp/a.png']), [])
  assert.deepEqual(imagePathsAllowed(true, ['/tmp/a.png', '/tmp/notes.txt', '/tmp/b.webp']), ['/tmp/a.png', '/tmp/b.webp'])
})

test('fitBox keeps aspect ratio', () => {
  assert.deepEqual(fitBox(2000, 1000, 1024), { width: 1024, height: 512 })
  assert.deepEqual(fitBox(400, 200, 1024), { width: 400, height: 200 })
  assert.deepEqual(fitBox(100, 800, 400), { width: 50, height: 400 })
})

test('jpeg and png EXIF segments are removed', () => {
  const payload = Buffer.from('Exif\0\0secret-gps-lat', 'latin1')
  const size = payload.length + 2
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1, (size >> 8) & 0xff, size & 0xff]),
    payload,
    Buffer.from([0xff, 0xd9]),
  ])
  const stripped = stripJpegExif(jpeg)
  assert.equal(stripped.includes(Buffer.from('secret-gps-lat')), false)
  assert.equal(stripped[0], 0xff)
  assert.equal(stripped[1], 0xd8)
  assert.equal(stripped.at(-2), 0xff)
  assert.equal(stripped.at(-1), 0xd9)

  const chunk = Buffer.from('eXIfsecret-gps', 'latin1')
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, chunk.length - 4]),
    chunk,
    Buffer.from([0, 0, 0, 0]),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from('IEND'),
    Buffer.from([0, 0, 0, 0]),
  ])
  const clean = stripPngExif(png)
  assert.equal(clean.includes(Buffer.from('secret-gps')), false)
  assert.equal(clean.includes(Buffer.from('IEND')), true)
})

test('preprocess resizes, strips EXIF, and converts png jpeg and webp', async () => {
  const canvas = createCanvas(2000, 1000)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 2000, 1000)
  ctx.fillStyle = '#111111'
  ctx.fillRect(100, 100, 400, 200)
  const png = canvas.toBuffer('image/png')
  const jpeg = canvas.toBuffer('image/jpeg', 90)
  const exif = Buffer.from('Exif\0\0secret-gps-lat', 'latin1')
  const size = exif.length + 2
  const marked = Buffer.concat([
    jpeg.subarray(0, 2),
    Buffer.from([0xff, 0xe1, (size >> 8) & 0xff, size & 0xff]),
    exif,
    jpeg.subarray(2),
  ])
  const prepared = await preprocessImage(marked, 'image/jpeg')
  assert.equal(prepared.width, 1024)
  assert.equal(prepared.height, 512)
  assert.equal(prepared.bytes.includes(Buffer.from('secret-gps-lat')), false)
  assert.ok(prepared.bytes.length < marked.length)

  const fromPng = await preprocessImage(png, 'image/png', { maxEdge: 640 })
  assert.equal(fromPng.width, 640)
  assert.equal(fromPng.height, 320)
  assert.equal(fromPng.bytes.includes(Buffer.from('eXIf')), false)

  let webp: Buffer | null = null
  try { webp = canvas.toBuffer('image/webp') } catch { webp = null }
  if (webp && webp.length > 16) {
    const fromWebp = await preprocessImage(webp, 'image/webp', { maxEdge: 320 })
    assert.equal(fromWebp.width, 320)
    assert.equal(fromWebp.height, 160)
    assert.ok(fromWebp.mime === 'image/png' || fromWebp.mime === 'image/jpeg')
  }

  const capped = await preprocessImage(png, 'image/png', { maxEdge: 1024, maxBytes: 8_000 })
  assert.ok(capped.bytes.length <= 8_000)
})

test('OCR is the path for text-heavy screenshots and when mmproj cannot load', () => {
  assert.equal(isTextHeavy({
    text: 'TypeError: Cannot read properties\nof undefined (reading map)',
    confidence: 80,
    width: 800,
    height: 400,
  }), true)
  assert.equal(isTextHeavy({ text: 'ok', confidence: 10, width: 800, height: 400 }), false)
  assert.equal(ocrFallbackChoice({ textHeavy: true, mmprojInstalled: true, runtimeSupports: true, ramOk: true }), 'ocr')
  assert.equal(ocrFallbackChoice({ textHeavy: false, mmprojInstalled: false, runtimeSupports: true, ramOk: true }), 'ocr')
  assert.equal(ocrFallbackChoice({ textHeavy: false, mmprojInstalled: true, runtimeSupports: false, ramOk: true }), 'ocr')
  assert.equal(ocrFallbackChoice({ textHeavy: false, mmprojInstalled: true, runtimeSupports: true, ramOk: true }), 'vision')
  const extracted = extractErrorText([
    'the window title',
    "TypeError: Cannot read properties of undefined (reading 'map')",
    '    at render (App.tsx:40:12)',
    'error TS2304: Cannot find name \'formatName\'.',
  ].join('\n'))
  assert.match(extracted, /TypeError/)
  assert.match(extracted, /App\.tsx:40:12/)
  assert.match(extracted, /TS2304/)
  assert.equal(extracted.includes('window title'), false)
})

test('error screenshots feed the fix task, mockups stay on the plan path, compare only describes', async () => {
  const image = {
    mime: 'image/png' as const,
    bytes: Buffer.from('png'),
    width: 800,
    height: 400,
  }
  const ocrText = "TypeError: Cannot read properties of undefined (reading 'map')\n    at render (App.tsx:40:12)"
  const error = await readScreenshots({
    userText: 'This error showed up after the last edit',
    agent: 'code',
    images: [image],
    mmprojInstalled: false,
    runtimeSupports: true,
    ramOk: true,
    ocr: async () => ({ text: ocrText, confidence: 90 }),
    describe: async () => { throw new Error('vision should not run') },
  })
  assert.equal(error.route, 'fix')
  assert.equal(error.skipGates, false)
  assert.equal(error.images.length, 0)
  assert.match(error.text, /TypeError/)
  assert.match(error.text, /Fix this error/)
  assert.notEqual(triageTask(error.text), 'chat')
  assert.match(error.note, /not installed/)

  const mockup = await readScreenshots({
    userText: 'Build the component from this mockup',
    agent: 'code',
    images: [image],
    mmprojInstalled: true,
    runtimeSupports: false,
    ramOk: true,
    ocr: async () => ({ text: 'Save button\nCancel button', confidence: 88 }),
    describe: async () => { throw new Error('vision should not run') },
  })
  assert.equal(mockup.route, 'plan')
  assert.equal(mockup.skipGates, false)
  assert.match(mockup.text, /Implement the interface/)
  assert.match(mockup.text, /Save button/)
  assert.match(mockup.note, /cannot load the screenshot add-on/)
  assert.notEqual(triageTask(mockup.text), 'chat')

  let described = 0
  const compare = await readScreenshots({
    userText: 'Compare this screenshot of the running app with the expected layout',
    agent: 'code',
    images: [image],
    mmprojInstalled: true,
    runtimeSupports: true,
    ramOk: true,
    ocr: async () => ({ text: 'ok', confidence: 10 }),
    describe: async (prompt) => {
      described += 1
      assert.match(prompt, /differences/)
      return 'The save button is missing.'
    },
  })
  assert.equal(compare.route, 'describe')
  assert.equal(described, 1)
  assert.match(compare.directAnswer ?? '', /save button is missing/)
  assert.equal(compare.skipGates, false)

  const heavy = await readScreenshots({
    userText: 'What is in this picture?',
    agent: 'chat',
    images: [image],
    mmprojInstalled: true,
    runtimeSupports: true,
    ramOk: true,
    ocr: async () => ({ text: ocrText, confidence: 92 }),
    describe: async () => { throw new Error('text-heavy chat uses OCR') },
  })
  assert.equal(heavy.route, 'chat')
  assert.equal(heavy.images.length, 0)
  assert.match(heavy.text, /TypeError/)
  assert.equal(heavy.note, '')
})

test('error task text is the extracted lines', () => {
  const task = buildErrorTask('fix the crash', "TypeError: bad\n    at render (App.tsx:1:1)")
  assert.match(task, /^Fix this error/)
  assert.match(task, /App\.tsx:1:1/)
})
