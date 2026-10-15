/** Clean chat-model name from the registry row. File names and quant strings stay out of the main UI. */
export function chatModelLabel(model: { family?: string | null; params_b?: number | null; label?: string | null }): string {
  const custom = model.label?.trim()
  if (custom) return custom
  const family = familyDisplayName(model.family)
  if (model.params_b == null || !Number.isFinite(model.params_b)) return family || 'Model'
  const size = Number.isInteger(model.params_b) ? String(model.params_b) : String(model.params_b)
  return family ? `${family} ${size}B` : `${size}B`
}

export function familyDisplayName(family: string | null | undefined): string {
  if (!family) return ''
  if (family === 'qwen3.5') return 'Qwen3.5'
  if (family === 'gemma4' || family === 'gemma-4') return 'Gemma 4'
  return family
}

export function quantFromFile(file: string): string | null {
  const hit = /(?:^|[-_.])(Q\d(?:_[0-9A-Za-z]+)*)(?:\.|$)/.exec(file)
  return hit?.[1] ?? null
}

/** Decimal gigabytes, so 1,574,961,408 bytes reads as 1.57 GB. */
export function formatModelSize(bytes: number): string {
  const gb = bytes / 1_000_000_000
  if (gb >= 0.1) return `${gb.toFixed(2)} GB`
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`
}

/** Picker line: name, download size, and the RAM the tier asks for. */
export function modelChoiceLabel(model: { label: string; sizeBytes: number; minRamGb: number }): string {
  const ram = Number.isInteger(model.minRamGb) ? String(model.minRamGb) : String(model.minRamGb)
  return `${model.label} · ${formatModelSize(model.sizeBytes)} · needs ${ram} GB RAM`
}

/** Code picker line: family, size name, quant, download size, RAM, and the RAM tier. */
export function codeModelLine(model: {
  family?: string | null
  sizeName?: string | null
  quant?: string | null
  sizeBytes: number
  minRamGb: number
}): string {
  const family = familyDisplayName(model.family) || 'Model'
  const size = model.sizeName?.trim() || 'size unknown'
  const quant = model.quant?.trim() || 'quant unknown'
  const ram = Number.isInteger(model.minRamGb) ? String(model.minRamGb) : String(model.minRamGb)
  return `${family} · ${size} · ${quant} · ${formatModelSize(model.sizeBytes)} · needs ${ram} GB RAM · ${ram} GB tier`
}

export function fitMarkLabel(mark: 'recommended' | 'fits' | 'too-big'): string {
  if (mark === 'recommended') return 'Recommended'
  if (mark === 'fits') return 'Fits'
  return 'Too big for this laptop'
}

/** Code-only rows carry `agents`. Older rows stay on General and Assistant. */
export function servesAgent(agents: string[] | undefined, agentId: string): boolean {
  if (agents && agents.length > 0) return agents.includes(agentId)
  return agentId !== 'code'
}
