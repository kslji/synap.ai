/**
 * llama.cpp multimodal support. The projector loads with --mmproj (libmtmd).
 * An unsupported build keeps answering from on-device OCR.
 */

export type VisionBlock = 'ok' | 'unsupported' | 'missing' | 'ram'

export function runtimeSupportsMmproj(helpText: string): boolean {
  return /--mmproj\b/.test(helpText) || /libmtmd/.test(helpText)
}

export function visionBlockReason(input: {
  runtimeSupports: boolean
  mmprojInstalled: boolean
  ramOk: boolean
}): VisionBlock {
  if (!input.runtimeSupports) return 'unsupported'
  if (!input.ramOk) return 'ram'
  if (!input.mmprojInstalled) return 'missing'
  return 'ok'
}

export function visionFallbackMessage(reason: Exclude<VisionBlock, 'ok'>): string {
  if (reason === 'unsupported') {
    return 'This llama.cpp build cannot load the screenshot add-on. The image is read as text on this computer.'
  }
  if (reason === 'ram') {
    return 'The screenshot add-on does not fit this computer\'s memory, so the image is read as text.'
  }
  return 'The screenshot add-on is not installed, so the image is read as text on this computer.'
}

/** --mmproj is passed only when the build, the file, and the RAM cap all agree. */
export function mmprojArg(input: { path: string; block: VisionBlock }): string {
  if (input.block !== 'ok' || !input.path) return ''
  return input.path
}
