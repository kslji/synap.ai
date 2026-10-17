/**
 * Tokens per second for one installed model file.
 * A missing row means the model has not been measured. Never invent a speed.
 */

export interface BenchmarkRow {
  modelId: string
  sizeBytes: number
  tokens: number
  elapsedMs: number
  tokensPerSec: number
  measuredAt: number
}

export interface BenchmarkFile {
  rows: BenchmarkRow[]
}

export function tokensPerSec(tokens: number, elapsedMs: number): number | null {
  if (!Number.isFinite(tokens) || !Number.isFinite(elapsedMs) || tokens <= 0 || elapsedMs <= 0) return null
  return Math.round((tokens / (elapsedMs / 1000)) * 10) / 10
}

export function readBenchmarkFile(raw: string): BenchmarkRow[] {
  try {
    const parsed = JSON.parse(raw) as { rows?: BenchmarkRow[] }
    if (!Array.isArray(parsed.rows)) return []
    return parsed.rows.filter(validRow)
  } catch {
    return []
  }
}

export function writeBenchmarkFile(rows: readonly BenchmarkRow[]): string {
  return JSON.stringify({ rows: rows.filter(validRow) }, null, 2)
}

export function upsertBenchmark(rows: readonly BenchmarkRow[], next: BenchmarkRow): BenchmarkRow[] {
  if (!validRow(next)) return [...rows]
  return [...rows.filter((row) => row.modelId !== next.modelId), next]
}

/** The saved speed applies only when the file size still matches the registry. */
export function benchmarkFor(rows: readonly BenchmarkRow[], modelId: string, sizeBytes: number): BenchmarkRow | null {
  const row = rows.find((item) => item.modelId === modelId)
  if (!row || row.sizeBytes !== sizeBytes) return null
  return row
}

function validRow(row: BenchmarkRow): boolean {
  return Boolean(row)
    && typeof row.modelId === 'string'
    && row.modelId.length > 0
    && row.modelId.length <= 80
    && Number.isFinite(row.sizeBytes)
    && row.sizeBytes > 0
    && Number.isFinite(row.tokens)
    && row.tokens > 0
    && Number.isFinite(row.elapsedMs)
    && row.elapsedMs > 0
    && Number.isFinite(row.tokensPerSec)
    && row.tokensPerSec > 0
    && Number.isFinite(row.measuredAt)
    && row.measuredAt > 0
}
