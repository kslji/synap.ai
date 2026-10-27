/**
 * Keep-warm, idle unload, per-step model choice, prompt-cache keys, and speculative decoding.
 * These functions do not start a process or download a file.
 */
import { createHash } from 'node:crypto'
import { codeFileCapBytes, laptopRamClass, offeredOnLaptop } from '../../../shared/code-ram.js'

export interface LiveModel {
  id: string
  family: string
  paramsB: number | null
  sizeBytes: number
  minRamGb: number
  /** Draft rows are never the chat model and are never kept warm on their own. */
  draft?: boolean
}

export const DRAFT_MODEL_ID = 'qwen3-0.6b-q4_k_m'
export const DEFAULT_IDLE_UNLOAD_MINUTES = 15

/** Qwen size for this laptop: 2B, 4B, then 9B. A file that misses the cap is skipped by the caller. */
export function qwenDefaultParams(totalRamGb: number): 2 | 4 | 9 {
  const klass = laptopRamClass(totalRamGb)
  if (klass >= 16) return 9
  if (klass >= 8) return 4
  return 2
}

/** File cap from the Code RAM table: 4 GB → 2 GB, 8 GB → 3 GB, 16 GB → 4 GB, 32 GB → 8 GB. */
export function modelFitsLaptop(model: Pick<LiveModel, 'sizeBytes' | 'minRamGb'>, totalRamGb: number): boolean {
  if (!offeredOnLaptop(model.minRamGb, totalRamGb)) return false
  return model.sizeBytes <= codeFileCapBytes(totalRamGb)
}

export function clampIdleMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_IDLE_UNLOAD_MINUTES
  return Math.min(240, Math.max(1, Math.round(minutes)))
}

export function selectKeepWarmModel(input: {
  enabled: boolean
  totalRamGb: number
  selectedId: string
  models: readonly LiveModel[]
  installed: ReadonlySet<string>
}): LiveModel | null {
  if (!input.enabled) return null
  const installed = input.models.filter((model) => input.installed.has(model.id) && !model.draft)
  const selected = installed.find((model) => model.id === input.selectedId)
  if (selected && modelFitsLaptop(selected, input.totalRamGb)) return selected
  const qwen = installed.filter((model) => model.family === 'qwen3.5' && modelFitsLaptop(model, input.totalRamGb))
  const want = qwenDefaultParams(input.totalRamGb)
  const preferred = qwen.filter((model) => model.paramsB === want).sort(smallerFile)
  if (preferred[0]) return preferred[0]
  return [...qwen].sort(largerParams)[0] ?? null
}

export function shouldUnload(input: {
  enabled: boolean
  busy: boolean
  lastUsedAt: number
  now: number
  idleMinutes: number
}): boolean {
  if (input.busy) return false
  if (!input.enabled) return true
  const limit = clampIdleMinutes(input.idleMinutes) * 60_000
  return input.now - input.lastUsedAt >= limit
}

/** Prompt cache RAM for llama-server -cram. 4 GB laptops stay at 0 so the cache stays off. */
export function promptCacheMiB(totalRamGb: number): number {
  const klass = laptopRamClass(totalRamGb)
  if (klass <= 4) return 0
  if (klass === 8) return 256
  if (klass === 16) return 512
  return 1024
}

export type StepRoute = 'triage' | 'edit' | 'plan' | 'hard-fix'

export function selectRoutePair(input: {
  totalRamGb: number
  models: readonly LiveModel[]
  installed: ReadonlySet<string>
}): { small: LiveModel | null; large: LiveModel | null; dual: boolean } {
  const fitting = input.models
    .filter((model) => input.installed.has(model.id) && !model.draft && modelFitsLaptop(model, input.totalRamGb))
    .sort(smallerParams)
  const small = fitting[0] ?? null
  const large = fitting[fitting.length - 1] ?? null
  const dual = Boolean(small && large && small.id !== large.id)
  return { small, large, dual }
}

export function routeStepModel(input: {
  kind: StepRoute
  small: LiveModel | null
  large: LiveModel | null
  dual: boolean
}): { modelId: string | null; reason: 'small' | 'large' | 'only' | 'none' } {
  const hard = input.kind === 'plan' || input.kind === 'hard-fix'
  if (input.dual && input.small && input.large) {
    return hard
      ? { modelId: input.large.id, reason: 'large' }
      : { modelId: input.small.id, reason: 'small' }
  }
  const only = input.large ?? input.small
  if (!only) return { modelId: null, reason: 'none' }
  return { modelId: only.id, reason: 'only' }
}

/** Stable prefix of system.md plus the project context. The same bytes always hash the same. */
export function prefixCacheKey(systemText: string, projectContext: string): string {
  return createHash('sha256').update('system\n').update(systemText).update('\nproject\n').update(projectContext).digest('hex')
}

/**
 * The first request with a prefix stores it (`cachePrompt`).
 * A later request with the same prefix reuses it. A changed prefix is stored again.
 * `cacheEnabled` is false on a 4 GB laptop, where the server starts with `-cram 0`.
 */
export function promptCacheReuse(previousKey: string | null, nextKey: string, cacheEnabled = true): { key: string; reuse: boolean; cachePrompt: boolean } {
  const reuse = cacheEnabled && previousKey != null && previousKey === nextKey
  return { key: nextKey, reuse, cachePrompt: cacheEnabled }
}

export type SpeculativeReason = 'on' | 'off' | 'runtime' | 'missing' | 'ram'

export function speculativeRamOk(totalRamGb: number, mainSizeBytes: number, draftSizeBytes: number, mainMinRamGb: number): boolean {
  if (laptopRamClass(totalRamGb) <= 4) return false
  if (!modelFitsLaptop({ sizeBytes: mainSizeBytes, minRamGb: mainMinRamGb }, totalRamGb)) return false
  return mainSizeBytes + draftSizeBytes <= codeFileCapBytes(totalRamGb)
}

export function speculativeDecision(input: {
  userEnabled: boolean
  runtimeSupports: boolean
  draftInstalled: boolean
  totalRamGb: number
  mainSizeBytes: number
  draftSizeBytes: number
  mainMinRamGb: number
}): { enabled: boolean; reason: SpeculativeReason; offerDownload: boolean } {
  const ramOk = speculativeRamOk(input.totalRamGb, input.mainSizeBytes, input.draftSizeBytes, input.mainMinRamGb)
  if (!input.userEnabled) {
    return { enabled: false, reason: 'off', offerDownload: !input.draftInstalled && ramOk && input.runtimeSupports }
  }
  if (!input.runtimeSupports) return { enabled: false, reason: 'runtime', offerDownload: false }
  if (!ramOk) return { enabled: false, reason: 'ram', offerDownload: false }
  if (!input.draftInstalled) return { enabled: false, reason: 'missing', offerDownload: true }
  return { enabled: true, reason: 'on', offerDownload: false }
}

/** llama-server flags. Empty unless the decision is on and a draft file path is known. */
export function speculativeServerArgs(enabled: boolean, draftPath: string, draftMax = 8): string[] {
  if (!enabled || !draftPath) return []
  // --draft-max was removed upstream (build 11514 errors on it); the current name is --spec-draft-n-max.
  return ['-md', draftPath, '--spec-draft-n-max', String(draftMax)]
}

export function runtimeSupportsSpeculative(helpText: string): boolean {
  return /--model-draft\b/.test(helpText) || /(^|\s)-md\b/.test(helpText)
}

function smallerFile(a: LiveModel, b: LiveModel): number {
  return a.sizeBytes - b.sizeBytes
}

function smallerParams(a: LiveModel, b: LiveModel): number {
  const params = (a.paramsB ?? 0) - (b.paramsB ?? 0)
  if (params !== 0) return params
  return a.sizeBytes - b.sizeBytes
}

function largerParams(a: LiveModel, b: LiveModel): number {
  return smallerParams(b, a)
}
