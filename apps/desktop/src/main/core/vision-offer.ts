/**
 * Whether the Qwen screenshot add-on (mmproj) is offered.
 * The file matches the installed Qwen3.5 row. It is never downloaded on its own.
 * The pair is offered only when the model and the projector both fit the laptop file cap.
 */
import { codeFileCapBytes } from '../../shared/code-ram.js'
import { modelFitsLaptop } from './live/policy.js'

export interface ScreenshotOfferInput {
  family: string
  modelInstalled: boolean
  modelBytes: number
  minRamGb: number
  mmprojBytes: number | null
  mmprojInstalled: boolean
  totalRamGb: number
  /** null until llama-server --help has been read. false hides the download. */
  runtimeSupports: boolean | null
}

export interface ScreenshotOffer {
  show: boolean
  offerDownload: boolean
  autoDownload: false
  sizeBytes: number | null
  reason: 'fit' | 'installed' | 'not-qwen' | 'no-file' | 'model-missing' | 'ram' | 'runtime'
}

/** Model file plus its matching mmproj stay inside the existing laptop file cap. */
export function visionPairFits(input: {
  modelBytes: number
  mmprojBytes: number
  minRamGb: number
  totalRamGb: number
}): boolean {
  if (!modelFitsLaptop({ sizeBytes: input.modelBytes, minRamGb: input.minRamGb }, input.totalRamGb)) return false
  return input.modelBytes + input.mmprojBytes <= codeFileCapBytes(input.totalRamGb)
}

export function screenshotAddonOffer(input: ScreenshotOfferInput): ScreenshotOffer {
  const none = (reason: ScreenshotOffer['reason']): ScreenshotOffer => ({
    show: false,
    offerDownload: false,
    autoDownload: false,
    sizeBytes: null,
    reason,
  })
  if (input.family !== 'qwen3.5') return none('not-qwen')
  if (input.mmprojBytes == null) return none('no-file')
  if (!input.modelInstalled) return none('model-missing')
  const fits = visionPairFits({
    modelBytes: input.modelBytes,
    mmprojBytes: input.mmprojBytes,
    minRamGb: input.minRamGb,
    totalRamGb: input.totalRamGb,
  })
  if (input.mmprojInstalled) {
    return { show: true, offerDownload: false, autoDownload: false, sizeBytes: input.mmprojBytes, reason: 'installed' }
  }
  if (!fits) return none('ram')
  if (input.runtimeSupports === false) return none('runtime')
  return { show: true, offerDownload: true, autoDownload: false, sizeBytes: input.mmprojBytes, reason: 'fit' }
}

/** Storage row label for a downloaded projector. Other files keep their names. */
export function screenshotStorageLabel(fileName: string): string {
  if (!/mmproj/i.test(fileName)) return fileName
  const split = fileName.indexOf('--')
  const modelId = split > 0 ? fileName.slice(0, split) : fileName
  return `Screenshot add-on · ${modelId}`
}
