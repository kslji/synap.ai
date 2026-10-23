/** Name people see: family plus size, such as Qwen 2B. Version, file, and quant stay out. */
export function friendlyModelName(model: {
  id?: string | null
  family?: string | null
  params_b?: number | null
  paramsB?: number | null
}): string {
  const fromId = friendlyNameFromId(model.id)
  if (fromId) return fromId
  const params = model.params_b ?? model.paramsB ?? null
  const family = publicFamily(model.family)
  if (params == null || !Number.isFinite(params)) return family || 'Model'
  return family ? `${family} ${formatParams(params)}` : formatParams(params)
}

/** Registry id to a short name. Unknown ids return null so the caller can keep its own text. */
export function friendlyNameFromId(id: string | null | undefined): string | null {
  if (!id) return null
  const bare = id.split('#')[0] ?? ''
  if (/^qwen/i.test(bare)) {
    const size = /(?:^|-)(\d+(?:\.\d+)?)b(?:-|$)/i.exec(bare)
    if (size) return `Qwen ${size[1]}B`
  }
  if (/^gemma/i.test(bare)) {
    const size = /(?:^|-)(?:e)?(\d+(?:\.\d+)?)b(?:-|$)/i.exec(bare)
    if (size) return `Gemma ${size[1]}B`
  }
  return null
}

/** Clean chat-model name. Custom registry labels are not shown when they carry a version or quant. */
export function chatModelLabel(model: { id?: string | null; family?: string | null; params_b?: number | null; label?: string | null }): string {
  return friendlyModelName(model)
}

function publicFamily(family: string | null | undefined): string {
  if (!family) return ''
  const key = family.toLowerCase()
  if (key.startsWith('qwen')) return 'Qwen'
  if (key.startsWith('gemma')) return 'Gemma'
  return family
}

function formatParams(params: number): string {
  return `${Number.isInteger(params) ? String(params) : String(params)}B`
}

export function familyDisplayName(family: string | null | undefined): string {
  if (!family) return ''
  if (family === 'qwen3.5') return 'Qwen3.5'
  if (family === 'gemma4' || family === 'gemma-4') return 'Gemma 4'
  return family
}

export function quantFromFile(file: string): string | null {
  const hit = /(?:^|[-_.])(q\d(?:_[0-9A-Za-z]+)*)(?=[-.]|$)/i.exec(file)
  return hit?.[1]?.toUpperCase() ?? null
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

/** Rows with `agents` (such as the draft) serve only those agents. Every other chat row serves every agent. */
export function servesAgent(agents: string[] | undefined, agentId: string): boolean {
  if (agents && agents.length > 0) return agents.includes(agentId)
  return true
}

/** `default_for: ["*"]` marks the default for every agent, which is how the 2B ships. */
export function isDefaultFor(model: { default_for?: string[] }, agentId: string): boolean {
  const marks = model.default_for ?? []
  return marks.includes('*') || marks.includes(agentId)
}
