/** Clean chat-model name. File names and quant strings stay out of the main UI. */
export function chatModelLabel(paramsB: number | null | undefined): string {
  if (paramsB == null || !Number.isFinite(paramsB)) return 'Qwen3.5'
  const size = Number.isInteger(paramsB) ? String(paramsB) : String(paramsB)
  return `Qwen3.5 ${size}B`
}

export function quantFromFile(file: string): string | null {
  const hit = /(?:^|[-_.])(Q\d(?:_[0-9A-Za-z]+)*)(?:\.|$)/.exec(file)
  return hit?.[1] ?? null
}
