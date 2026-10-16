/**
 * Tab suggestions follow the same RAM rules as Code models.
 * On by default only when the active Code model's minimum RAM fits this laptop.
 */
import { offeredOnLaptop } from '../../../../shared/code-ram.js'

export function tabSuggestionsDefault(totalRamGb: number, modelMinRamGb: number): boolean {
  return offeredOnLaptop(modelMinRamGb, totalRamGb)
}

export function languageSuggestionsOn(language: string, off: readonly string[]): boolean {
  const id = language.trim().toLowerCase()
  if (!id) return true
  return !off.some((item) => item.trim().toLowerCase() === id)
}

export function normalizeLanguagesOff(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const id = value.trim().toLowerCase()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= 40) break
  }
  return out
}
