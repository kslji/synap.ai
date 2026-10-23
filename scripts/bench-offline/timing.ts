/**
 * Pure timing maths for the offline benchmark. Kept apart from bench.ts so it can be
 * unit-tested without starting a server (bench.ts runs main() on import).
 *
 * All arguments are `performance.now()` instants, never a mix of instants and durations:
 * that mix is what produced a first-token figure of -5437 ms when a streaming reply
 * carried no content delta and the fallback subtracted `started` from an elapsed time.
 */

/**
 * Time to the first content token, in whole ms.
 * `firstTokenAt` <= 0 means no content delta arrived at all; the honest answer is then
 * the whole request, and never a negative number.
 */
export function firstTokenMs(startedAt: number, firstTokenAt: number, endedAt: number): number {
  const at = firstTokenAt > 0 ? Math.max(firstTokenAt, startedAt) : endedAt;
  return Math.max(0, Math.round(at - startedAt));
}

/**
 * Decode speed over the window between the first and the last token.
 * `tokens` counts every token including the first, so the window covers `tokens - 1` steps.
 * Returns 0 when there is nothing to measure, rather than dividing by zero.
 */
export function decodeSpeed(tokens: number, firstTokenAt: number, endedAt: number): number {
  if (tokens < 2 || firstTokenAt <= 0) return 0;
  const windowMs = Math.max(1, endedAt - firstTokenAt);
  return Number((((tokens - 1) / windowMs) * 1000).toFixed(1));
}

/** Nearest-rank percentile over a copy, so callers keep their sample order. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function round(value: number, digits = 0): number {
  return Number(value.toFixed(digits));
}
