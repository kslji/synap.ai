/**
 * Code-agent screenshot preparation.
 * preprocessImage, limitsForFamily, and the OCR decision are the reuse surface
 * for a later General-agent Gemma integration. This module does not call the
 * general chat path.
 */
import { diffImages, describeDiff } from './compare.js'
import { errorBlock, mockupBlock, refineShotUse, classifyShotUse, VISION_PROMPTS, type ShotUse } from './intent.js'
import { limitsForFamily } from './limits.js'
import { extractErrorLines, isTextHeavy, ocrInsteadOfModel, type OcrRead } from './ocr-fallback.js'
import { preprocessImage, type EncodedMime, type PreparedImage } from './preprocess.js'

export interface VisionImage {
  bytes: Buffer
  mime: EncodedMime
}

export interface PrepareResult {
  use: ShotUse
  task: string
  /** Set when the reply is the measured description and the plan/patch loop should not run. */
  answerOnly: string | null
  needsModel: boolean
  modelPrompt: string | null
  images: VisionImage[]
}

export async function prepareCodeVision(input: {
  userText: string
  images: Buffer[]
  mmprojAvailable: boolean
  family: string
  ocr: (image: Buffer) => Promise<OcrRead>
  describe?: (images: VisionImage[], prompt: string) => Promise<string>
}): Promise<PrepareResult> {
  const limits = limitsForFamily(input.family)
  const shots: PreparedImage[] = []
  for (const image of input.images.slice(0, 4)) {
    shots.push(await preprocessImage(image, limits))
  }
  const ocrTexts: string[] = []
  let textHeavy = false
  for (const shot of shots) {
    try {
      const read = await input.ocr(shot.bytes)
      ocrTexts.push(read.text)
      if (isTextHeavy(read.text, read.confidence)) textHeavy = true
    } catch {
      ocrTexts.push('')
    }
  }
  const errorLines = extractErrorLines(ocrTexts.join('\n'))
  let use = refineShotUse(classifyShotUse(input.userText, shots.length), input.userText, errorLines)
  const prepared: VisionImage[] = shots.map((shot) => ({ bytes: shot.bytes, mime: shot.mime }))
  const useOcr = ocrInsteadOfModel({ mmprojAvailable: input.mmprojAvailable, textHeavy })
  const askModel = input.mmprojAvailable && !useOcr && (
    use === 'mockup' || use === 'compare' || use === 'describe' || (use === 'error' && errorLines.length === 0)
  )
  const prompt = promptFor(use)
  let narration = ''
  const left = shots[0]
  const right = shots[1]
  if (use === 'compare' && left && right) {
    const facts = await diffImages(left.bytes, right.bytes, ocrTexts[0] ?? '', ocrTexts[1] ?? '')
    const measured = describeDiff(facts)
    if (askModel && input.describe) narration = await narrate(input.describe, prepared, `${prompt}\n\nMeasurements:\n${measured}`)
    const answer = [measured, narration].filter(Boolean).join('\n\n')
    return { use, task: input.userText, answerOnly: answer, needsModel: false, modelPrompt: null, images: prepared }
  }
  if (askModel && input.describe && (use === 'mockup' || use === 'describe' || (use === 'error' && errorLines.length === 0))) {
    narration = await narrate(input.describe, prepared, prompt)
  }
  if (use === 'error') {
    const lines = errorLines.length ? errorLines : narration ? [narration] : []
    return {
      use,
      task: `${input.userText.trim()}\n\n${errorBlock(lines)}`.trim(),
      answerOnly: null,
      needsModel: false,
      modelPrompt: null,
      images: prepared,
    }
  }
  if (use === 'mockup') {
    const notes = narration || ocrTexts.filter(Boolean).join('\n')
    return {
      use,
      task: `${input.userText.trim()}\n\n${mockupBlock(notes)}`.trim(),
      answerOnly: null,
      needsModel: false,
      modelPrompt: null,
      images: prepared,
    }
  }
  const text = narration || ocrTexts.filter(Boolean).join('\n') || 'No text could be read from the screenshot.'
  return { use: 'describe', task: input.userText, answerOnly: text, needsModel: false, modelPrompt: null, images: prepared }
}

async function narrate(
  describe: (images: VisionImage[], prompt: string) => Promise<string>,
  images: VisionImage[],
  prompt: string,
): Promise<string> {
  try {
    return (await describe(images, prompt)).trim()
  } catch {
    return ''
  }
}

function promptFor(use: ShotUse): string {
  if (use === 'error') return VISION_PROMPTS.error
  if (use === 'compare') return VISION_PROMPTS.compare
  return VISION_PROMPTS.mockup
}

export { limitsForFamily, preprocessImage, extractErrorLines, ocrInsteadOfModel }
export { imagesForAgent } from './intent.js'
