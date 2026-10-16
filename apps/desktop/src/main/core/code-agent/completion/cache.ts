/** Recent completions keyed by the file prefix. A longer prefix reuses the unused tail. */

export interface CacheKey {
  prefix: string
  suffix: string
  language: string
}

interface CacheEntry extends CacheKey {
  completion: string
}

export class CompletionCache {
  private entries: CacheEntry[] = []

  constructor(private readonly limit = 32) {}

  put(key: CacheKey, completion: string): void {
    if (!completion) return
    this.entries = this.entries.filter((entry) => !sameKey(entry, key))
    this.entries.push({ ...key, completion })
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit)
  }

  get(key: CacheKey): string | null {
    let best: { rest: string; prefixLength: number } | null = null
    for (const entry of this.entries) {
      if (entry.language !== key.language || entry.suffix !== key.suffix) continue
      if (!key.prefix.startsWith(entry.prefix)) continue
      const typed = key.prefix.slice(entry.prefix.length)
      if (!entry.completion.startsWith(typed)) continue
      const rest = entry.completion.slice(typed.length)
      if (!best || entry.prefix.length > best.prefixLength) best = { rest, prefixLength: entry.prefix.length }
    }
    return best ? best.rest : null
  }

  get size(): number {
    return this.entries.length
  }
}

function sameKey(entry: CacheKey, key: CacheKey): boolean {
  return entry.prefix === key.prefix && entry.suffix === key.suffix && entry.language === key.language
}
