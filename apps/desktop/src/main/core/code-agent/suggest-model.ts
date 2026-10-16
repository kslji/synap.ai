/**
 * After the failure ladder, name one larger model that fits this laptop.
 * This does not download anything.
 */
import { codeFileCapBytes, offeredOnLaptop } from '../../../shared/code-ram.js'

export interface CodeModelChoice {
  id: string
  family: string
  paramsB: number | null
  sizeBytes: number
  minRamGb: number
  agents?: readonly string[]
  defaultFor?: readonly string[]
  label?: string
  sizeName?: string
}

export interface ModelSuggestion {
  id: string
  label: string
  sizeBytes: number
}

export function suggestBiggerCodeModel(
  currentId: string,
  totalRamGb: number,
  models: readonly CodeModelChoice[],
): ModelSuggestion | null {
  const codeModels = models.filter(isCodeModel)
  const current = codeModels.find((model) => model.id === currentId) ?? models.find((model) => model.id === currentId)
  const currentParams = current?.paramsB ?? 0
  const cap = codeFileCapBytes(totalRamGb)
  const fitting = codeModels.filter((model) => {
    if (model.id === currentId) return false
    if (!offeredOnLaptop(model.minRamGb, totalRamGb)) return false
    if (model.sizeBytes > cap) return false
    return (model.paramsB ?? 0) > currentParams
  })
  const qwen = fitting.filter((model) => model.family === 'qwen3.5').sort(smallerFirst)
  const gemma = fitting.filter((model) => model.family === 'gemma4').sort(smallerFirst)
  const next = qwen[0] ?? gemma[0]
  if (!next) return null
  return { id: next.id, label: choiceLabel(next), sizeBytes: next.sizeBytes }
}

export function suggestionSentence(suggestion: ModelSuggestion): string {
  const gb = (suggestion.sizeBytes / 1_000_000_000).toFixed(2)
  return `A larger model that fits this laptop is ${suggestion.label} (${suggestion.id}, ${gb} GB). Download it in Models if you want to retry. Nothing is downloaded automatically.`
}

function isCodeModel(model: CodeModelChoice): boolean {
  return model.agents?.includes('code') === true || model.defaultFor?.includes('code') === true
}

function smallerFirst(a: CodeModelChoice, b: CodeModelChoice): number {
  const params = (a.paramsB ?? 0) - (b.paramsB ?? 0)
  if (params !== 0) return params
  return a.sizeBytes - b.sizeBytes
}

function choiceLabel(model: CodeModelChoice): string {
  if (model.label) return model.label
  const size = model.sizeName ?? (model.paramsB != null ? `${model.paramsB}B` : model.id)
  if (model.family === 'qwen3.5') return `Qwen ${size}`
  if (model.family === 'gemma4') return `Gemma 4 ${size}`
  return size
}
