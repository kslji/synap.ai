/** Local appearance choices. These are settings, not measurements. */

export const ACCENTS = ['orange', 'blue', 'indigo', 'navy'] as const
export const DENSITIES = ['compact', 'comfortable', 'relaxed'] as const
export const DEFAULT_MASCOT_NAME = 'Surf'
export const DEFAULT_MASCOT_COLOR = '#f2740f'
/** Saved bot name. About one short name, not a sentence. */
export const BOT_NAME_LIMIT = 32

export type AccentId = (typeof ACCENTS)[number]
export type DensityId = (typeof DENSITIES)[number]

export function cleanMascotName(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_MASCOT_NAME
  const name = value.replace(/\s+/g, ' ').trim().slice(0, BOT_NAME_LIMIT)
  return name || DEFAULT_MASCOT_NAME
}

export function cleanMascotColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_MASCOT_COLOR
  const hex = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : DEFAULT_MASCOT_COLOR
}

export function cleanAccent(value: unknown): AccentId {
  return ACCENTS.includes(value as AccentId) ? (value as AccentId) : 'orange'
}

export function cleanDensity(value: unknown): DensityId {
  return DENSITIES.includes(value as DensityId) ? (value as DensityId) : 'comfortable'
}

export function cleanAnimate(value: unknown, fallback = true): boolean {
  return typeof value === 'boolean' ? value : fallback
}
