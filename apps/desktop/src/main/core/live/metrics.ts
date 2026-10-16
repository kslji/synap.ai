/**
 * Local usage totals. Samples are counts and timings. They never carry prompt or answer text.
 */

export interface UsageSample {
  at: number
  modelId: string
  tasks: number
  steps: number
  tokensIn: number
  tokensOut: number
  ttftMs: number | null
  genMs: number | null
  ramMb: number | null
  cpuPercent: number | null
}

export interface UsageModelRow {
  modelId: string
  tasks: number
  steps: number
  tokensIn: number
  tokensOut: number
  tokensPerSec: number | null
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  ramMb: number | null
  cpuPercent: number | null
}

export interface UsageDayRow {
  day: string
  tasks: number
  steps: number
  tokensIn: number
  tokensOut: number
  tokensPerSec: number | null
  ttftP50Ms: number | null
  ttftP95Ms: number | null
}

export interface UsageReport {
  tasks: number
  steps: number
  tokensIn: number
  tokensOut: number
  tokensPerSec: number | null
  ttftP50Ms: number | null
  ttftP95Ms: number | null
  ramMb: number | null
  cpuPercent: number | null
  models: UsageModelRow[]
  days: UsageDayRow[]
  localOnly: true
}

export const EMPTY_USAGE: UsageReport = {
  tasks: 0,
  steps: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokensPerSec: null,
  ttftP50Ms: null,
  ttftP95Ms: null,
  ramMb: null,
  cpuPercent: null,
  models: [],
  days: [],
  localOnly: true,
}

const MAX_SAMPLES = 4000

export function appendSample(samples: readonly UsageSample[], sample: UsageSample): UsageSample[] {
  const next = [...samples, normalize(sample)]
  if (next.length <= MAX_SAMPLES) return next
  return next.slice(next.length - MAX_SAMPLES)
}

export function aggregateUsage(samples: readonly UsageSample[]): UsageReport {
  const rows = samples.map(normalize)
  const byModel = new Map<string, UsageSample[]>()
  const byDay = new Map<string, UsageSample[]>()
  for (const sample of rows) {
    const model = byModel.get(sample.modelId) ?? []
    model.push(sample)
    byModel.set(sample.modelId, model)
    const day = new Date(sample.at).toISOString().slice(0, 10)
    const list = byDay.get(day) ?? []
    list.push(sample)
    byDay.set(day, list)
  }
  return {
    ...summarize(rows),
    models: [...byModel.entries()]
      .map(([modelId, list]) => ({ modelId, ...summarize(list) }))
      .sort((a, b) => b.tokensOut - a.tokensOut || a.modelId.localeCompare(b.modelId)),
    days: [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, list]) => ({ day, ...summarize(list) })),
    localOnly: true,
  }
}

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length) - 1
  const index = Math.min(sorted.length - 1, Math.max(0, rank))
  return sorted[index] ?? null
}

/** One local log line. Counts and timings only. */
export function metricLine(sample: UsageSample): string {
  const row = normalize(sample)
  const speed = row.genMs && row.genMs > 0 ? row.tokensOut / (row.genMs / 1000) : null
  return [
    `at=${row.at}`,
    `model=${row.modelId}`,
    `tasks=${row.tasks}`,
    `steps=${row.steps}`,
    `tokens_in=${row.tokensIn}`,
    `tokens_out=${row.tokensOut}`,
    `ttft_ms=${num(row.ttftMs)}`,
    `gen_ms=${num(row.genMs)}`,
    `tokens_per_s=${num(speed)}`,
    `ram_mb=${num(row.ramMb)}`,
    `cpu_pct=${num(row.cpuPercent)}`,
  ].join(' ')
}

export function parseProcCpu(statText: string): { ticks: number } | null {
  const match = /^\d+\s+\(.*\)\s+(\S.*)$/.exec(statText.trim())
  if (!match?.[1]) return null
  const fields = match[1].split(/\s+/)
  const utime = Number(fields[11])
  const stime = Number(fields[12])
  if (!Number.isFinite(utime) || !Number.isFinite(stime)) return null
  return { ticks: utime + stime }
}

export function cpuPercent(prevTicks: number, nextTicks: number, elapsedMs: number, clockTicks = 100): number | null {
  if (elapsedMs <= 0 || clockTicks <= 0) return null
  const delta = nextTicks - prevTicks
  if (delta < 0) return null
  const pct = (delta / clockTicks) / (elapsedMs / 1000) * 100
  if (!Number.isFinite(pct)) return null
  return Math.round(Math.min(100, pct) * 10) / 10
}

function summarize(samples: readonly UsageSample[]): Omit<UsageReport, 'models' | 'days' | 'localOnly'> {
  let tasks = 0
  let steps = 0
  let tokensIn = 0
  let tokensOut = 0
  let genMs = 0
  let genTokens = 0
  const ttft: number[] = []
  const ram: number[] = []
  const cpu: number[] = []
  for (const sample of samples) {
    tasks += sample.tasks
    steps += sample.steps
    tokensIn += sample.tokensIn
    tokensOut += sample.tokensOut
    if (sample.ttftMs != null) ttft.push(sample.ttftMs)
    if (sample.ramMb != null) ram.push(sample.ramMb)
    if (sample.cpuPercent != null) cpu.push(sample.cpuPercent)
    if (sample.genMs != null && sample.genMs > 0 && sample.tokensOut > 0) {
      genMs += sample.genMs
      genTokens += sample.tokensOut
    }
  }
  return {
    tasks,
    steps,
    tokensIn,
    tokensOut,
    tokensPerSec: genMs > 0 ? round1(genTokens / (genMs / 1000)) : null,
    ttftP50Ms: percentile(ttft, 50),
    ttftP95Ms: percentile(ttft, 95),
    ramMb: mean(ram),
    cpuPercent: mean(cpu),
  }
}

function normalize(sample: UsageSample): UsageSample {
  return {
    at: Math.max(0, Math.round(sample.at)),
    modelId: sample.modelId.slice(0, 80),
    tasks: nonNeg(sample.tasks),
    steps: nonNeg(sample.steps),
    tokensIn: nonNeg(sample.tokensIn),
    tokensOut: nonNeg(sample.tokensOut),
    ttftMs: sample.ttftMs == null ? null : Math.max(0, sample.ttftMs),
    genMs: sample.genMs == null ? null : Math.max(0, sample.genMs),
    ramMb: sample.ramMb == null ? null : Math.max(0, sample.ramMb),
    cpuPercent: sample.cpuPercent == null ? null : Math.max(0, Math.min(100, sample.cpuPercent)),
  }
}

function nonNeg(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

function mean(values: number[]): number | null {
  if (!values.length) return null
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function num(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return ''
  return String(round1(value))
}
