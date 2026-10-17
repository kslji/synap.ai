/**
 * First open: the person picks Qwen 2B, 4B, or 9B. EmbeddingGemma is fetched
 * with that file. RAM only marks a recommendation and a warning. A size that
 * needs more memory stays selectable.
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

export interface SetupEmbed {
  id: string
  name: string
  file: string
  sizeBytes: number
  sha256: string
  url: string
}

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

export function setupEmbedding(models: readonly {
  id: string
  role?: string
  file: string
  url: string
  size_bytes: number
  sha256: string
}[]): SetupEmbed | null {
  const row = models.find((model) => model.role === 'embedding' && model.size_bytes > 0 && /^[a-f0-9]{64}$/.test(model.sha256))
  if (!row) return null
  return {
    id: row.id,
    name: 'EmbeddingGemma',
    file: row.file,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    url: row.url,
  }
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

export function recommendSetupModel(ramGb: number | null, catalog: readonly SetupModel[]): { id: string; source: 'ram' | 'default' } {
  const fallback = catalog.find((model) => model.token === '2b') ?? catalog[0]
  if (!fallback) throw new Error('no setup model')
  if (ramGb == null || !Number.isFinite(ramGb) || ramGb <= 0) return { id: fallback.id, source: 'default' }
  const band = ramBand(ramGb)
  const token = band === '16gb' ? '9b' : band === '8gb' ? '4b' : '2b'
  const picked = catalog.find((model) => model.token === token) ?? fallback
  return { id: picked.id, source: 'ram' }
}

/** An 8 GB machine often reports about 7.5 GB. 0.8 GB covers that without treating 4 GB as 8 GB. */
export function ramFits(minRamGb: number, ramGb: number): boolean {
  return minRamGb <= ramGb + 0.8
}

export interface SetupChoiceView {
  id: string
  name: string
  sizeBytes: number
  minRamGb: number
  recommended: boolean
  warning: string | null
  inDownloads: boolean
}

export function setupChoices(catalog: readonly SetupModel[], ramGb: number | null, downloadsIds: readonly string[]): SetupChoiceView[] {
  const known = ramGb != null && Number.isFinite(ramGb) && ramGb > 0
  const recommended = recommendSetupModel(known ? ramGb : null, catalog)
  return catalog.map((model) => {
    const tight = known && !ramFits(model.minRamGb, ramGb)
    return {
      id: model.id,
      name: model.name,
      sizeBytes: model.sizeBytes,
      minRamGb: model.minRamGb,
      recommended: recommended.source === 'ram' && model.id === recommended.id,
      warning: tight ? `This model needs ${model.minRamGb} GB of memory. This computer has ${formatRamGb(ramGb)}.` : null,
      inDownloads: downloadsIds.includes(model.id),
    }
  })
}

export function requiredFreeBytes(sizeBytes: number): number {
  return Math.ceil(sizeBytes * 1.05)
}

export interface SetupStep {
  id: string
  role: 'chat' | 'embedding'
  name: string
  file: string
  url: string
  sha256: string
  sizeBytes: number
  action: 'download' | 'copy' | 'ready'
}

export interface FirstRunPlan {
  action: 'done' | 'disk' | 'run'
  modelId: string
  steps: SetupStep[]
  requiredBytes?: number
  freeBytes?: number
}

export function planFirstRun(input: {
  chosenId: string
  useDownloads: boolean
  freeBytes: number | null
  chatInstalled: boolean
  embedInstalled: boolean
  chatInDownloads: boolean
  embedInDownloads: boolean
  catalog: readonly SetupModel[]
  embedding: SetupEmbed
}): FirstRunPlan {
  const chosen = input.catalog.find((model) => model.id === input.chosenId) ?? input.catalog[0]
  if (!chosen) throw new Error('no setup model')
  const chatAction: SetupStep['action'] = input.chatInstalled
    ? 'ready'
    : input.useDownloads && input.chatInDownloads
      ? 'copy'
      : 'download'
  const embedAction: SetupStep['action'] = input.embedInstalled
    ? 'ready'
    : input.embedInDownloads
      ? 'copy'
      : 'download'
  const steps: SetupStep[] = [
    {
      id: chosen.id,
      role: 'chat',
      name: chosen.name,
      file: chosen.file,
      url: chosen.url,
      sha256: chosen.sha256,
      sizeBytes: chosen.sizeBytes,
      action: chatAction,
    },
    {
      id: input.embedding.id,
      role: 'embedding',
      name: input.embedding.name,
      file: input.embedding.file,
      url: input.embedding.url,
      sha256: input.embedding.sha256,
      sizeBytes: input.embedding.sizeBytes,
      action: embedAction,
    },
  ]
  if (steps.every((step) => step.action === 'ready')) return { action: 'done', modelId: chosen.id, steps }
  const pending = steps.filter((step) => step.action !== 'ready').reduce((sum, step) => sum + step.sizeBytes, 0)
  const requiredBytes = requiredFreeBytes(pending)
  if (input.freeBytes != null && Number.isFinite(input.freeBytes) && input.freeBytes < requiredBytes) {
    return { action: 'disk', modelId: chosen.id, steps, requiredBytes, freeBytes: input.freeBytes }
  }
  return { action: 'run', modelId: chosen.id, steps }
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

export function setupErrorCopy(error: {
  code: 'offline' | 'disk' | 'checksum' | 'http'
  requiredBytes?: number | null
  freeBytes?: number | null
  httpStatus?: number | null
}): { title: string; body: string } {
  if (error.code === 'offline') {
    return {
      title: 'No internet',
      body: 'The download paused. Retry when you are back online. The part that already arrived is kept.',
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
  const status = error.httpStatus != null ? ` (HTTP ${error.httpStatus})` : ''
  return { title: 'Download stopped', body: `The download stopped${status}. Retry continues from the part already saved.` }
}

export const SETUP_TOKENS = TOKENS

export interface SetupFileView {
  id: string
  name: string
  role: 'chat' | 'embedding'
  done: number
  total: number
  state: 'waiting' | 'active' | 'done'
}

export interface SetupErrorView {
  code: 'offline' | 'disk' | 'checksum' | 'http'
  requiredBytes?: number | null
  freeBytes?: number | null
  httpStatus?: number | null
}

export interface SetupSnapshot {
  phase: 'pick' | 'checking' | 'downloading' | 'paused' | 'done' | 'error'
  modelId: string
  modelName: string
  ramGb: number | null
  choices: SetupChoiceView[]
  files: SetupFileView[]
  done: number
  total: number
  bytesPerSecond: number | null
  error: SetupErrorView | null
}

const EMBED_BYTES = 309_855_520

/** Screenshot harness only. Counts are the registry sizes, passed through the same formatters. */
export function setupShot(kind: 'pick' | 'progress' | 'paused' | 'offline' | 'disk' | 'checksum'): SetupSnapshot {
  const chatTotal = 1_280_835_840
  const done = 412_000_000
  const rate = byteRate([{ at: 0, bytes: 0 }, { at: 2000, bytes: 16_400_000 }])
  const files: SetupFileView[] = [
    { id: 'qwen3.5-2b-q4_k_m', name: 'Qwen 2B', role: 'chat', done, total: chatTotal, state: 'active' },
    { id: 'embeddinggemma-2-text-q8_0', name: 'EmbeddingGemma', role: 'embedding', done: 0, total: EMBED_BYTES, state: 'waiting' },
  ]
  const base: SetupSnapshot = {
    phase: 'downloading',
    modelId: 'qwen3.5-2b-q4_k_m',
    modelName: 'Qwen 2B',
    ramGb: 8,
    choices: [],
    files,
    done,
    total: chatTotal,
    bytesPerSecond: rate,
    error: null,
  }
  if (kind === 'pick') {
    return {
      ...base,
      phase: 'pick',
      modelId: '',
      modelName: '',
      files: [],
      done: 0,
      total: 0,
      bytesPerSecond: null,
      choices: [
        { id: 'qwen3.5-2b-q4_k_m', name: 'Qwen 2B', sizeBytes: chatTotal, minRamGb: 4, recommended: false, warning: null, inDownloads: true },
        { id: 'qwen3.5-4b-q4_k_m', name: 'Qwen 4B', sizeBytes: 2_740_937_888, minRamGb: 8, recommended: true, warning: null, inDownloads: false },
        { id: 'qwen3.5-9b-q4_k_m', name: 'Qwen 9B', sizeBytes: 5_680_522_464, minRamGb: 16, recommended: false, warning: 'This model needs 16 GB of memory. This computer has 8 GB.', inDownloads: false },
      ],
    }
  }
  if (kind === 'progress') return base
  if (kind === 'paused') return { ...base, phase: 'paused', bytesPerSecond: null }
  if (kind === 'offline') return { ...base, phase: 'error', bytesPerSecond: null, error: { code: 'offline' } }
  if (kind === 'disk') {
    const required = requiredFreeBytes(chatTotal + EMBED_BYTES)
    return {
      ...base,
      phase: 'error',
      files: files.map((file) => ({ ...file, done: 0, state: 'waiting' as const })),
      done: 0,
      bytesPerSecond: null,
      error: { code: 'disk', requiredBytes: required, freeBytes: 200_000_000 },
    }
  }
  return {
    ...base,
    phase: 'error',
    files: files.map((file) => ({ ...file, done: 0, state: 'waiting' as const })),
    done: 0,
    bytesPerSecond: null,
    error: { code: 'checksum' },
  }
}
