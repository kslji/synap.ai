/**
 * Which Qwen3.5 Q4_K_M file the first open should fetch.
 *
 * The website bakes the choice into the installer. A synap:// link is only a
 * fallback: an unsigned app is not the handler until after it has been opened.
 * A disk-image name does not survive dragging the app out on macOS.
 * When nothing names a size, the choice follows installed RAM:
 * under 8 GB → 2B, 8 GB → 4B, 16 GB and above → 9B.
 * Those are the same cuts as tierFor in hardware.ts (7.3 GB and 15 GB,
 * because the OS reports a little under the sticker size).
 * If RAM cannot be read, the choice is 2B.
 */
import { FIRST_RUN_CHAT_MODEL_IDS } from './starter-model'

export interface SetupModel {
  id: string
  token: '2b' | '4b' | '9b'
  name: string
  file: string
  minRamGb: number
  sizeBytes: number
  sha256: string
  url: string
}

/** GitHub rejects a release asset at or above 2 GiB. */
export const GITHUB_ASSET_LIMIT_BYTES = 2 * 1024 * 1024 * 1024

const TOKENS = ['2b', '4b', '9b'] as const

export function isSetupModelId(id: string | null | undefined): id is string {
  return Boolean(id) && (FIRST_RUN_CHAT_MODEL_IDS as readonly string[]).includes(id as string)
}

export function setupCatalog(models: readonly {
  id: string
  file: string
  url: string
  size_bytes: number
  sha256: string
  min_ram_gb: number
  params_b?: number | null
}[]): SetupModel[] {
  const out: SetupModel[] = []
  for (const id of FIRST_RUN_CHAT_MODEL_IDS) {
    const row = models.find((model) => model.id === id)
    if (!row || row.size_bytes <= 0 || !/^[a-f0-9]{64}$/.test(row.sha256)) continue
    const token = tokenFor(row.id)
    if (!token) continue
    const params = row.params_b ?? Number(token.replace('b', ''))
    out.push({
      id: row.id,
      token,
      name: `Qwen ${params}B`,
      file: row.file,
      minRamGb: row.min_ram_gb,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      url: row.url,
    })
  }
  return out
}

function tokenFor(id: string): SetupModel['token'] | null {
  if (id.includes('-2b-')) return '2b'
  if (id.includes('-4b-')) return '4b'
  if (id.includes('-9b-')) return '9b'
  return null
}

/** 8 GB and 16 GB stickers often report a little under that. Same cuts as tierFor. */
export function ramBand(ramGb: number): '4gb' | '8gb' | '16gb' {
  if (ramGb >= 15) return '16gb'
  if (ramGb >= 7.3) return '8gb'
  return '4gb'
}

export function recommendSetupModel(ramGb: number | null, catalog: readonly SetupModel[]): { id: string; source: 'ram' | 'default'; band: '4gb' | '8gb' | '16gb' | 'unknown' } {
  const fallback = catalog.find((model) => model.token === '2b') ?? catalog[0]
  if (!fallback) throw new Error('no setup model')
  if (ramGb == null || !Number.isFinite(ramGb) || ramGb <= 0) return { id: fallback.id, source: 'default', band: 'unknown' }
  const band = ramBand(ramGb)
  const token = band === '16gb' ? '9b' : band === '8gb' ? '4b' : '2b'
  const picked = catalog.find((model) => model.token === token) ?? fallback
  return { id: picked.id, source: 'ram', band }
}

export function modelFromMarker(text: string | null | undefined): string | null {
  if (!text?.trim()) return null
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const row = parsed as { model?: unknown; size?: unknown }
  if (typeof row.model === 'string' && isSetupModelId(row.model.trim())) return row.model.trim()
  if (typeof row.size === 'string') return idForToken(row.size.trim().toLowerCase())
  return null
}

export function idForToken(token: string): string | null {
  if (token === '2b' || token === 'offline-2b') return 'qwen3.5-2b-q4_k_m'
  if (token === '4b') return 'qwen3.5-4b-q4_k_m'
  if (token === '9b') return 'qwen3.5-9b-q4_k_m'
  return null
}

/** Installer file name used by the website and by the Windows NSIS script. */
export function modelFromInstallerName(name: string | null | undefined): { id: string; bundled: boolean } | null {
  if (!name) return null
  const base = name.split(/[/\\]/).pop() ?? name
  if (/-offline-2b\.(dmg|exe|zip)$/i.test(base)) return { id: 'qwen3.5-2b-q4_k_m', bundled: true }
  const match = /-(2b|4b|9b)\.(dmg|exe|zip)$/i.exec(base)
  if (!match) return null
  const id = idForToken(match[1].toLowerCase())
  return id ? { id, bundled: false } : null
}

export function isSizedInstallerName(name: string): boolean {
  return modelFromInstallerName(name) != null
}

export function chooseSetupModel(input: {
  overrideId: string | null
  markerId: string | null
  linkId: string | null
  ramGb: number | null
  catalog: readonly SetupModel[]
}): { id: string; source: 'override' | 'installer' | 'link' | 'ram' | 'default' } {
  for (const [id, source] of [
    [input.overrideId, 'override'],
    [input.markerId, 'installer'],
    [input.linkId, 'link'],
  ] as const) {
    if (isSetupModelId(id) && input.catalog.some((model) => model.id === id)) return { id, source }
  }
  const recommended = recommendSetupModel(input.ramGb, input.catalog)
  return { id: recommended.id, source: recommended.source }
}

/** An 8 GB machine often reports about 7.5 GB. 0.8 GB covers that without treating 4 GB as 8 GB. */
export function ramFits(minRamGb: number, ramGb: number): boolean {
  return minRamGb <= ramGb + 0.8
}

export function suggestSmaller(currentId: string, ramGb: number, catalog: readonly SetupModel[]): string | null {
  const current = catalog.find((model) => model.id === currentId)
  if (!current) return null
  const smaller = catalog
    .filter((model) => model.id !== current.id && model.minRamGb < current.minRamGb && ramFits(model.minRamGb, ramGb))
    .sort((a, b) => b.minRamGb - a.minRamGb || b.sizeBytes - a.sizeBytes)
  if (smaller[0]) return smaller[0].id
  const smallest = catalog.find((model) => model.token === '2b')
  return smallest && smallest.id !== current.id ? smallest.id : null
}

export function requiredFreeBytes(sizeBytes: number): number {
  return Math.ceil(sizeBytes * 1.05)
}

export interface SetupPlan {
  action: 'done' | 'copy' | 'download' | 'ram' | 'disk'
  modelId: string
  via?: 'installed' | 'adopted'
  ramGb?: number
  needRamGb?: number
  suggestId?: string | null
  requiredBytes?: number
  freeBytes?: number
}

export function planSetup(input: {
  chosenId: string
  ramGb: number | null
  freeBytes: number | null
  installedIds: readonly string[]
  adoptedId: string | null
  bundledIds: readonly string[]
  catalog: readonly SetupModel[]
}): SetupPlan {
  const chosen = input.catalog.find((model) => model.id === input.chosenId) ?? input.catalog[0]
  if (!chosen) throw new Error('no setup model')
  if (input.installedIds.includes(chosen.id)) return { action: 'done', modelId: chosen.id, via: 'installed' }
  if (input.adoptedId && input.catalog.some((model) => model.id === input.adoptedId)) {
    return { action: 'done', modelId: input.adoptedId, via: 'adopted' }
  }
  if (input.ramGb != null && Number.isFinite(input.ramGb) && input.ramGb > 0 && !ramFits(chosen.minRamGb, input.ramGb)) {
    return {
      action: 'ram',
      modelId: chosen.id,
      ramGb: input.ramGb,
      needRamGb: chosen.minRamGb,
      suggestId: suggestSmaller(chosen.id, input.ramGb, input.catalog),
    }
  }
  const bundled = input.bundledIds.includes(chosen.id)
  if (input.freeBytes != null && Number.isFinite(input.freeBytes) && input.freeBytes < requiredFreeBytes(chosen.sizeBytes)) {
    return { action: 'disk', modelId: chosen.id, requiredBytes: requiredFreeBytes(chosen.sizeBytes), freeBytes: input.freeBytes }
  }
  if (bundled) return { action: 'copy', modelId: chosen.id }
  return { action: 'download', modelId: chosen.id }
}

/** Bytes per second from the oldest and newest samples. Null until two real samples exist. */
export function byteRate(samples: readonly { at: number; bytes: number }[]): number | null {
  if (samples.length < 2) return null
  const previous = samples[0]
  const latest = samples[samples.length - 1]
  const elapsed = latest.at - previous.at
  const gained = latest.bytes - previous.bytes
  if (elapsed <= 0 || gained < 0) return null
  return (gained * 1000) / elapsed
}

/** Decimal units, from the byte count. GB keeps two decimals so 1280835840 is 1.28 GB. */
export function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1000) return `${Math.round(bytes)} B`
  if (bytes < 1_000_000) return `${trimDecimal(bytes / 1000, 1)} KB`
  if (bytes < 1_000_000_000) return `${trimDecimal(bytes / 1_000_000, 1)} MB`
  return `${trimDecimal(bytes / 1_000_000_000, 2)} GB`
}

export function formatByteRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return ''
  return `${formatByteCount(bytesPerSecond)}/s`
}

function trimDecimal(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export function formatRamGb(ramGb: number): string {
  if (!Number.isFinite(ramGb) || ramGb <= 0) return ''
  const digits = Number.isInteger(ramGb) ? 0 : 1
  return `${trimDecimal(ramGb, digits)} GB`
}

export function setupChoiceNote(source: 'override' | 'installer' | 'link' | 'ram' | 'default', modelName: string, ramGb: number | null): string {
  if (source === 'ram' && ramGb != null && ramGb > 0) {
    return `This computer has ${formatRamGb(ramGb)} of memory, so this is ${modelName}.`
  }
  if (source === 'default') return `${modelName} is the default when the installer did not name a size.`
  if (source === 'override') return `${modelName} is the smaller model that fits this computer.`
  return `${modelName} is the size chosen with the installer.`
}

export function setupErrorCopy(error: {
  code: 'offline' | 'disk' | 'checksum' | 'ram' | 'http'
  requiredBytes?: number | null
  freeBytes?: number | null
  ramGb?: number | null
  needRamGb?: number | null
  suggestName?: string | null
  httpStatus?: number | null
}): { title: string; body: string } {
  if (error.code === 'offline') {
    return {
      title: 'No internet',
      body: 'The download paused. Retry when you are back online. The part that already arrived is kept. An offline installer with Qwen 2B is on synap.surf if this computer cannot connect.',
    }
  }
  if (error.code === 'disk') {
    const need = error.requiredBytes != null ? formatByteCount(error.requiredBytes) : ''
    const free = error.freeBytes != null ? formatByteCount(error.freeBytes) : ''
    const body = need && free
      ? `This model needs ${need} of free space. This disk has ${free} free.`
      : 'This disk does not have enough free space for the model.'
    return { title: 'Not enough disk space', body }
  }
  if (error.code === 'checksum') {
    return {
      title: 'Download did not match',
      body: 'The file did not match its checksum, so it was deleted. Retry downloads it again.',
    }
  }
  if (error.code === 'ram') {
    const have = error.ramGb != null ? formatRamGb(error.ramGb) : ''
    const need = error.needRamGb != null ? `${error.needRamGb} GB` : ''
    const suggest = error.suggestName ? ` ${error.suggestName} is a smaller model that fits.` : ''
    const body = have && need
      ? `This computer has ${have} of memory. This model needs ${need}.${suggest}`
      : `This computer does not have enough memory for this model.${suggest}`
    return { title: 'Not enough memory', body }
  }
  const status = error.httpStatus != null ? ` (HTTP ${error.httpStatus})` : ''
  return { title: 'Download stopped', body: `The download stopped${status}. Retry continues from the part already saved.` }
}

export const SETUP_TOKENS = TOKENS

export interface SetupErrorView {
  code: 'offline' | 'disk' | 'checksum' | 'ram' | 'http'
  requiredBytes?: number | null
  freeBytes?: number | null
  ramGb?: number | null
  needRamGb?: number | null
  suggestId?: string | null
  suggestName?: string | null
  httpStatus?: number | null
}

export interface SetupSnapshot {
  phase: 'idle' | 'checking' | 'downloading' | 'copying' | 'paused' | 'done' | 'error'
  modelId: string
  modelName: string
  source: 'override' | 'installer' | 'link' | 'ram' | 'default'
  ramGb: number | null
  done: number
  total: number
  bytesPerSecond: number | null
  error: SetupErrorView | null
}
