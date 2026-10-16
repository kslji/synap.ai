/**
 * Whether Settings may offer the Qwen3.5 Code mmproj.
 * The file is never downloaded unless the user asks, and only when the model
 * plus the projector fit the same RAM file cap as the rest of the Code agent.
 */
import { codeFileCapBytes } from '../../../shared/code-ram.js'
import { mmprojDestName } from '../model-registry.js'
import { modelFitsLaptop } from '../live/policy.js'

export type VisionOfferReason = 'ok' | 'not-qwen' | 'not-code' | 'no-file' | 'not-installed' | 'ram'

export interface VisionOfferInput {
  family: string
  agents: readonly string[]
  installed: boolean
  totalRamGb: number
  modelSizeBytes: number
  mmprojSizeBytes: number
  minRamGb: number
  hasMmproj: boolean
}

export function qwenVisionOffer(input: VisionOfferInput): { offer: boolean; autoDownload: false; reason: VisionOfferReason } {
  const autoDownload = false as const
  if (input.family !== 'qwen3.5') return { offer: false, autoDownload, reason: 'not-qwen' }
  if (!input.agents.includes('code')) return { offer: false, autoDownload, reason: 'not-code' }
  if (!input.hasMmproj || input.mmprojSizeBytes <= 0) return { offer: false, autoDownload, reason: 'no-file' }
  if (!input.installed) return { offer: false, autoDownload, reason: 'not-installed' }
  const fits = modelFitsLaptop({ sizeBytes: input.modelSizeBytes, minRamGb: input.minRamGb }, input.totalRamGb)
  const room = input.modelSizeBytes + input.mmprojSizeBytes <= codeFileCapBytes(input.totalRamGb)
  if (!fits || !room) return { offer: false, autoDownload, reason: 'ram' }
  return { offer: true, autoDownload, reason: 'ok' }
}

export function visionOfferMessage(reason: VisionOfferReason): string {
  if (reason === 'ram') return 'This computer does not have room for the model and the screenshot add-on together.'
  if (reason === 'not-installed') return 'Install the Qwen3.5 Code model before its screenshot add-on.'
  return 'The screenshot add-on is only offered for an installed Qwen3.5 Code model that fits this computer.'
}

export function screenshotStorageLabel(
  fileName: string,
  models: readonly { id: string; label: string; file: string; mmprojFile?: string }[],
): string {
  for (const model of models) {
    if (fileName === model.file) return model.label
    if (model.mmprojFile && fileName === mmprojDestName(model.id, model.mmprojFile)) return `${model.label} screenshot add-on`
  }
  return fileName
}
