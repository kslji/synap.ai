/**
 * Screenshot routing stays in code.
 * The model only quotes text, describes a screen, or plans a change.
 * Ask and Auto gates stay in the existing plan and patch runner.
 */
import type { ChatMessage, ContentPart } from './llama-client.js'
import { extractErrorText, isTextHeavy } from './vision-ocr.js'
import type { PreparedImage } from './vision-preprocess.js'
import { visionBlockReason, visionFallbackMessage, type VisionBlock } from './vision-runtime.js'

export type ScreenshotUse = 'error' | 'mockup' | 'compare' | 'describe'
export type ScreenshotRoute = 'fix' | 'plan' | 'describe' | 'chat'

export interface ScreenshotRead {
  text: string
  images: PreparedImage[]
  note: string
  route: ScreenshotRoute
  /** Set when the model already answered and no further tool run should start. */
  directAnswer: string | null
  /** Ask and Auto gates stay in the runner. This plan never turns them off. */
  skipGates: false
  /** Text from on-device OCR, kept so a failed projector load can still answer. */
  ocrText: string
}

export function classifyScreenshot(userText: string): ScreenshotUse {
  const text = userText.toLowerCase()
  if (/\b(compare|comparison|difference|differences|differs|versus|vs\.?)\b/.test(text)) return 'compare'
  if (/\bexpected\b/.test(text) && /\b(screenshot|screen|image|running|layout)\b/.test(text)) return 'compare'
  if (/\b(mock-?up|wireframe|ui|interface|layout|component|screen design)\b/.test(text)) return 'mockup'
  if (/\b(error|exception|traceback|stack trace|failed|failure|crash|bug)\b/.test(text)) return 'error'
  return 'describe'
}

export function buildErrorTask(userText: string, extracted: string): string {
  const body = extracted.trim() || 'No error text could be read from the screenshot.'
  return `Fix this error from the screenshot.\n\nError text:\n${body}\n\n${userText.trim()}`.trim()
}

export function buildMockupTask(userText: string, description: string): string {
  const body = description.trim() || 'No interface text could be read from the screenshot.'
  return `Implement the interface shown in this screenshot.\n\nScreen:\n${body}\n\n${userText.trim()}`.trim()
}

export function buildComparePrompt(userText: string, readings: readonly string[]): string {
  const labeled = readings.map((text, index) => `Image ${index + 1}:\n${text.trim() || '(no text read)'}`).join('\n\n')
  return `${userText.trim()}\n\nDescribe the differences between the running app and the expected screen. Do not edit files.\n\n${labeled}`.trim()
}

function joinedOcr(rows: readonly { text: string }[]): string {
  return rows.map((row) => row.text.trim()).filter(Boolean).join('\n\n')
}

export async function readScreenshots(input: {
  userText: string
  agent: 'chat' | 'code'
  images: PreparedImage[]
  mmprojInstalled: boolean
  runtimeSupports: boolean
  ramOk: boolean
  ocr: (image: PreparedImage) => Promise<{ text: string; confidence: number }>
  /** Quotes or describes. Called only when the plan needs the model before the tool loop. */
  describe: (prompt: string, images: PreparedImage[]) => Promise<string>
}): Promise<ScreenshotRead> {
  if (input.images.length === 0) {
    return { text: input.userText, images: [], note: '', route: 'chat', directAnswer: null, skipGates: false, ocrText: '' }
  }
  const readings: { text: string; confidence: number; width: number; height: number }[] = []
  for (const image of input.images) {
    const found = await input.ocr(image)
    readings.push({ ...found, width: image.width, height: image.height })
  }
  const heavy = readings.some((row) => isTextHeavy(row))
  const block: VisionBlock = visionBlockReason({
    runtimeSupports: input.runtimeSupports,
    mmprojInstalled: input.mmprojInstalled,
    ramOk: input.ramOk,
  })
  const useVision = block === 'ok' && !heavy
  const note = block === 'ok' ? '' : visionFallbackMessage(block)
  const ocrText = joinedOcr(readings)
  const use = input.agent === 'code' ? classifyScreenshot(input.userText) : 'describe'

  if (input.agent !== 'code') {
    if (useVision) {
      return { text: input.userText, images: input.images, note, route: 'chat', directAnswer: null, skipGates: false, ocrText }
    }
    const text = ocrText
      ? `${input.userText.trim()}\n\nText read from the image on this computer:\n${ocrText}`.trim()
      : input.userText
    return { text, images: [], note, route: 'chat', directAnswer: null, skipGates: false, ocrText }
  }

  if (use === 'compare') {
    if (useVision) {
      const answer = await input.describe(
        'Describe the differences between these screenshots. Image 1 is the running app and image 2 is the expected screen when two images are attached. Do not write code.',
        input.images,
      )
      return { text: input.userText, images: [], note, route: 'describe', directAnswer: withNote(note, answer), skipGates: false, ocrText }
    }
    const prompt = buildComparePrompt(input.userText, readings.map((row) => row.text))
    const answer = await input.describe(prompt, [])
    return { text: prompt, images: [], note, route: 'describe', directAnswer: withNote(note, answer), skipGates: false, ocrText }
  }

  if (use === 'error') {
    let source = ocrText
    if (useVision) {
      const quoted = await input.describe('Quote the error text in this screenshot. Do not suggest a fix.', input.images)
      source = quoted.trim() || ocrText
    }
    const extracted = extractErrorText(source) || source.trim()
    if (!extracted) {
      return {
        text: input.userText,
        images: [],
        note,
        route: 'describe',
        directAnswer: withNote(note, 'No error text could be read from that screenshot.'),
        skipGates: false, ocrText,
      }
    }
    return { text: buildErrorTask(input.userText, extracted), images: [], note, route: 'fix', directAnswer: null, skipGates: false, ocrText }
  }

  if (use === 'mockup') {
    let description = ocrText
    if (useVision) {
      const quoted = await input.describe('Describe the interface in this screenshot. List the controls and the visible text. Do not write code.', input.images)
      description = quoted.trim() || ocrText
    }
    if (!description.trim()) {
      return {
        text: input.userText,
        images: [],
        note,
        route: 'describe',
        directAnswer: withNote(note, 'No interface text could be read from that screenshot.'),
        skipGates: false, ocrText,
      }
    }
    return { text: buildMockupTask(input.userText, description), images: [], note, route: 'plan', directAnswer: null, skipGates: false, ocrText }
  }

  if (useVision) {
    const answer = await input.describe('Describe this screenshot. Quote any words you can see. Do not edit files.', input.images)
    return { text: input.userText, images: [], note, route: 'describe', directAnswer: withNote(note, answer), skipGates: false, ocrText }
  }
  const prompt = ocrText
    ? `${input.userText.trim()}\n\nText read from the screenshot on this computer:\n${ocrText}\n\nAnswer from that text. Do not edit files.`.trim()
    : input.userText
  if (!ocrText) {
    return {
      text: input.userText,
      images: [],
      note,
      route: 'describe',
      directAnswer: withNote(note, 'No text could be read from that screenshot.'),
      skipGates: false, ocrText,
    }
  }
  const answer = await input.describe(prompt, [])
  return { text: prompt, images: [], note, route: 'describe', directAnswer: withNote(note, answer), skipGates: false, ocrText }
}

export function attachPreparedImages(messages: ChatMessage[], images: readonly PreparedImage[], question: string): ChatMessage[] {
  if (!images.length) return messages
  const copy = messages.map((message) => ({ ...message }))
  let index = -1
  for (let i = copy.length - 1; i >= 0; i -= 1) {
    if (copy[i].role === 'user') { index = i; break }
  }
  const content: ContentPart[] = [
    ...images.map((image) => ({
      type: 'image_url' as const,
      image_url: { url: `data:${image.mime};base64,${image.bytes.toString('base64')}` },
    })),
    { type: 'text', text: question },
  ]
  if (index >= 0) copy[index] = { ...copy[index], content }
  else copy.push({ role: 'user', content })
  return copy
}

function withNote(note: string, answer: string): string {
  const body = answer.trim()
  if (!note) return body
  if (!body) return note
  return `${note}\n\n${body}`
}
