/** Indexes of [S1], [S2], … that the answer text actually uses, in first-seen order. */

export function citedSourceIndexes(text: string): number[] {
  const seen: number[] = []
  for (const match of text.matchAll(/\[S(\d+)\]/g)) {
    const n = Number(match[1])
    if (n >= 1 && !seen.includes(n)) seen.push(n)
  }
  return seen
}

export function citedFileSources<T extends { filePath?: string }>(text: string, sources: readonly T[]): { source: T; n: number }[] {
  return citedSourceIndexes(text).flatMap((n) => {
    const source = sources[n - 1]
    if (!source?.filePath) return []
    return [{ source, n }]
  })
}
