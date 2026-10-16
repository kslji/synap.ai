/**
 * Region is never a hardcoded country.
 * A place named in the question wins. A filled-in "My region" setting wins over the IP
 * country so a VPN exit node does not pick the sources. Otherwise the public IP is
 * looked up in a local country file. If that file is missing or the IP is unknown,
 * the result is worldwide.
 */
import { assertNetworkAllowed } from '../offline-guard.js'
import type { RegionChoice } from './types.js'

export interface Place {
  code: string
  label: string
  re: RegExp
}

/** Names and official bodies used only to read a place out of a question. Not a default. */
export const PLACES: Place[] = [
  { code: 'IN', label: 'India', re: /\b(india|indian|sebi|rbi|amfi|nse|bse|india code)\b/i },
  { code: 'US', label: 'the United States', re: /\b(united states|u\.s\.a\.|usa|america|sec)\b/i },
  { code: 'GB', label: 'the United Kingdom', re: /\b(united kingdom|britain|uk|fca)\b/i },
  { code: 'JP', label: 'Japan', re: /\bjapan\b/i },
  { code: 'DE', label: 'Germany', re: /\bgermany\b/i },
  { code: 'FR', label: 'France', re: /\bfrance\b/i },
  { code: 'CA', label: 'Canada', re: /\bcanada\b/i },
  { code: 'AU', label: 'Australia', re: /\baustralia\b/i },
  { code: 'SG', label: 'Singapore', re: /\bsingapore\b/i },
  { code: 'AE', label: 'the United Arab Emirates', re: /\b(united arab emirates|uae)\b/i },
  { code: 'BR', label: 'Brazil', re: /\bbrazil\b/i },
  { code: 'ZA', label: 'South Africa', re: /\bsouth africa\b/i },
]

const LABELS: Record<string, string> = Object.fromEntries(PLACES.map((place) => [place.code, place.label]))

export function regionBanner(label: string): string {
  return `Showing results for ${label}.`
}

export function placeInQuestion(question: string): { code: string; label: string } | null {
  for (const place of PLACES) {
    if (place.re.test(question)) return { code: place.code, label: place.label }
  }
  return null
}

export function labelForCode(code: string): string {
  const upper = code.trim().toUpperCase()
  if (!upper || upper === 'GLOBAL') return 'worldwide sources'
  return LABELS[upper] ?? upper
}

export function normalizeSetting(value: string): { code: string; label: string } | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (/^[A-Z]{2}$/.test(upper)) return { code: upper, label: labelForCode(upper) }
  for (const place of PLACES) {
    if (place.label.toLowerCase() === trimmed.toLowerCase() || place.re.test(trimmed)) return { code: place.code, label: place.label }
  }
  return { code: upper.slice(0, 32), label: trimmed }
}

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = value * 256 + n
  }
  return value >>> 0
}

export interface IpRange {
  start: number
  end: number
  code: string
}

/** Lines are "start end CC" or "a.b.c.d/prefix CC". Blank lines and # comments are ignored. */
export function parseCountryTable(text: string): IpRange[] {
  const ranges: IpRange[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const bits = line.split(/\s+/)
    if (bits.length < 2) continue
    const code = bits[bits.length - 1].toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) continue
    if (bits[0].includes('/')) {
      const [addr, prefixRaw] = bits[0].split('/')
      const start = ipv4ToInt(addr)
      const prefix = Number(prefixRaw)
      if (start == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) continue
      const size = prefix === 0 ? 2 ** 32 : 2 ** (32 - prefix)
      ranges.push({ start, end: Math.min(start + size - 1, 0xffffffff), code })
      continue
    }
    const start = bits[0].includes('.') ? ipv4ToInt(bits[0]) : Number(bits[0])
    const end = bits[1].includes('.') ? ipv4ToInt(bits[1]) : Number(bits[1])
    if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) continue
    ranges.push({ start: start >>> 0, end: end >>> 0, code })
  }
  ranges.sort((a, b) => a.start - b.start)
  return ranges
}

export function lookupCountry(ip: string, table: string | IpRange[]): string | null {
  const value = ipv4ToInt(ip)
  if (value == null) return null
  const ranges = typeof table === 'string' ? parseCountryTable(table) : table
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const row = ranges[mid]
    if (value < row.start) hi = mid - 1
    else if (value > row.end) lo = mid + 1
    else return row.code
  }
  return null
}

export async function fetchPublicIp(fetchImpl: typeof fetch, timeoutMs = 2000): Promise<string | null> {
  try {
    const res = await fetchImpl('https://api.ipify.org', { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const text = (await res.text()).trim()
    if (ipv4ToInt(text) == null) return null
    return text
  } catch {
    return null
  }
}

export async function resolveRegion(input: {
  question: string
  myRegion: string
  offlineOnly: boolean
  geoText: string | null
  fetchImpl?: typeof fetch
}): Promise<RegionChoice> {
  const named = placeInQuestion(input.question)
  if (named) return { ...named, source: 'question' }
  const setting = normalizeSetting(input.myRegion)
  if (setting) return { ...setting, source: 'setting' }
  if (!input.offlineOnly && input.geoText && input.fetchImpl) {
    try {
      assertNetworkAllowed(input.offlineOnly)
      const ip = await fetchPublicIp(input.fetchImpl)
      const code = ip ? lookupCountry(ip, input.geoText) : null
      if (code) return { code, label: labelForCode(code), source: 'ip' }
    } catch {
      /* detection failed; fall through */
    }
  }
  return { code: 'GLOBAL', label: 'worldwide sources', source: 'global' }
}
