/**
 * Figures, dates, links, section numbers, and quotes in an answer must appear
 * in a source record. A missing, failed, empty, future, or stale source does
 * not authorize a value. The model is not a source.
 */
import type { Citation } from '../ipc-contract.js'

export const UNABLE_PRICE = 'Unable to find the price right now. Please try again in a moment.'
export const UNABLE_NEWS = 'Unable to find that news right now. Please try again in a moment.'
export const UNABLE_LEGAL = 'Unable to find that section right now. Please try again in a moment.'
export const UNABLE_FACT = 'Unable to find that fact right now. Please try again in a moment.'

export const PRICE_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const NAV_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const STOCK_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000
export const NEWS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export type ClaimTopic = 'price' | 'news' | 'legal' | 'fact'

export interface SourceRecord {
  id: string
  kind: 'price' | 'nav' | 'crypto' | 'stock' | 'news' | 'legal' | 'fact' | 'math' | 'page' | 'question'
  text: string
  url: string
  asOf: string | null
  cachedAt: number | null
  stale: boolean
}

export function cacheLabel(fetchedAt: number): string {
  return `Cached on ${new Date(fetchedAt).toISOString().slice(0, 10)}. Not a live fetch.`
}

export function unableMessage(topic: ClaimTopic): string {
  if (topic === 'news') return UNABLE_NEWS
  if (topic === 'legal') return UNABLE_LEGAL
  if (topic === 'fact') return UNABLE_FACT
  return UNABLE_PRICE
}

export function claimTopic(question: string): ClaimTopic | null {
  if (/\b(section\s+\d+|statute|india code|penal code|act\b)/i.test(question)) return 'legal'
  if (/\b(news|headline|circular|announcement)\b/i.test(question)) return 'news'
  if (/\b(price|nav|bitcoin|btc|ethereum|eth|solana|nifty|sensex|stock|share|amfi|coingecko|mutual fund)\b/i.test(question)) return 'price'
  return null
}

/** A source date in the future, or older than maxAgeMs, cannot support a current figure. */
export function sourceUsable(asOf: string | null | undefined, now: number, maxAgeMs: number): boolean {
  if (!asOf || !asOf.trim()) return false
  const at = parseSourceDate(asOf)
  if (at == null) return false
  if (at > now + 24 * 60 * 60 * 1000) return false
  return now - at <= maxAgeMs
}

export function parseSourceDate(value: string): number | null {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? null : parsed
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed)
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  const dmy = /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})/.exec(value.trim())
  if (dmy) {
    const month = MONTHS[dmy[2].slice(0, 3).toLowerCase()]
    if (month == null) return null
    return Date.UTC(Number(dmy[3]), month, Number(dmy[1]))
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function recordsFromCitations(citations: Citation[], kind: SourceRecord['kind']): SourceRecord[] {
  return citations.map((citation, index) => ({
    id: `S${index + 1}`,
    kind,
    text: [citation.excerpt, citation.title, citation.url, citation.published].filter(Boolean).join('\n'),
    url: citation.url || '',
    asOf: citation.published ?? null,
    cachedAt: null,
    stale: false,
  }))
}

export function recordsFromContext(input: {
  question: string
  chunks: { title?: string; text: string; url?: string; published?: string | null; cachedAt?: number | null }[]
  toolText?: string
}): SourceRecord[] {
  const records: SourceRecord[] = [{
    id: 'question',
    kind: 'question',
    text: input.question,
    url: '',
    asOf: null,
    cachedAt: null,
    stale: false,
  }]
  input.chunks.forEach((chunk, index) => {
    records.push({
      id: `S${index + 1}`,
      kind: 'page',
      text: [chunk.title, chunk.text, chunk.url, chunk.published].filter(Boolean).join('\n'),
      url: chunk.url || '',
      asOf: chunk.published ?? null,
      cachedAt: chunk.cachedAt ?? null,
      stale: false,
    })
  })
  if (input.toolText?.trim()) {
    records.push({
      id: 'tool',
      kind: 'math',
      text: input.toolText,
      url: '',
      asOf: null,
      cachedAt: null,
      stale: false,
    })
  }
  return records
}

const URL_RE = /https?:\/\/[^\s)>\]]+/gi
const SECTION_RE = /\bsection\s+(\d+[a-z]?)\b/gi
const QUOTE_RE = /["“]([^"”]{16,})["”]/g
const DATE_RE = /\b(\d{4}-\d{2}-\d{2}|\d{1,2}-[A-Za-z]{3,9}-\d{4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b/g
const MONEY_RE = /(?:\$|₹|usd|inr|rs\.?)\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*\.\d{2}\b/gi
const NUMBER_RE = /\d+(?:\.\d+)?/g

function fold(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ')
}

function ageLimit(kind: SourceRecord['kind'], topic: ClaimTopic | null): number {
  if (kind === 'nav') return NAV_MAX_AGE_MS
  if (kind === 'stock') return STOCK_MAX_AGE_MS
  if (kind === 'news' || kind === 'legal' || topic === 'news' || topic === 'legal') return NEWS_MAX_AGE_MS
  return PRICE_MAX_AGE_MS
}

function marketKind(kind: SourceRecord['kind']): boolean {
  return kind === 'price' || kind === 'nav' || kind === 'crypto' || kind === 'stock'
}

/** Market and news rows authorize a figure only inside their freshness window. */
function authorizing(records: SourceRecord[], topic: ClaimTopic | null, now: number): SourceRecord[] {
  return records.filter((record) => {
    if (record.kind === 'question' || record.stale) return false
    if (record.kind === 'math') return true
    const maxAge = ageLimit(record.kind, topic)
    const dated = marketKind(record.kind) || record.kind === 'news' || topic === 'price' || topic === 'news'
    if (dated && record.kind !== 'legal') {
      if (record.cachedAt != null && now - record.cachedAt > maxAge) return false
      if (record.asOf) return sourceUsable(record.asOf, now, maxAge)
      if (record.cachedAt != null) return true
      if (marketKind(record.kind) || topic === 'price' || topic === 'news') return false
    }
    if (topic === 'legal' && record.cachedAt != null && now - record.cachedAt > NEWS_MAX_AGE_MS) return false
    return true
  })
}

function hideCacheLabel(value: string): string {
  return value.replace(/cached on \d{4}-\d{2}-\d{2}\. not a live fetch\./gi, ' ')
}

function withoutCacheLabel(value: string): string {
  return value.replace(/[ \t]*cached on \d{4}-\d{2}-\d{2}\. not a live fetch\./gi, '').replace(/\n{2,}/g, '\n').trim()
}

function has(haystack: string, needle: string): boolean {
  const folded = fold(needle)
  return folded.length > 0 && haystack.includes(folded)
}

/** A number counts only as its own token, so 17 does not match inside 170. */
function hasNumber(haystack: string, number: string): boolean {
  const token = fold(number)
  if (!token) return false
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[^\\d])${escaped}(?:[^\\d]|$)`).test(fold(haystack))
}

interface Span {
  start: number
  end: number
  token: string
}

function reset(pattern: RegExp): RegExp {
  pattern.lastIndex = 0
  return pattern
}

function insideCitation(text: string, start: number, end: number): boolean {
  return text.slice(Math.max(0, start - 2), start) === '[S' && text[end] === ']'
}

function covered(spans: Span[], start: number, end: number): boolean {
  return spans.some((span) => start >= span.start && end <= span.end)
}

function tidy(value: string): string {
  return value
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end)
  const merged: Span[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

function removeSpans(text: string, spans: Span[]): string {
  let out = ''
  let cursor = 0
  for (const span of mergeSpans(spans)) {
    out += text.slice(cursor, span.start)
    cursor = span.end
  }
  return tidy(out + text.slice(cursor))
}

/** A kept sentence still has a figure, link, section, quote, or source sentence. */
function hasGroundedClaim(text: string, allowed: string, sources: string[]): boolean {
  if (!text.trim() || !allowed.trim()) return false
  for (const match of text.matchAll(reset(DATE_RE))) {
    const date = match[1] ?? match[0]
    if (has(allowed, date)) return true
  }
  for (const match of text.matchAll(reset(URL_RE))) {
    if (has(allowed, match[0].replace(/[.,]+$/, ''))) return true
  }
  for (const match of text.matchAll(reset(SECTION_RE))) {
    if (has(allowed, match[0])) return true
  }
  for (const match of text.matchAll(reset(QUOTE_RE))) {
    if (match[1] && has(allowed, match[1])) return true
  }
  for (const match of text.matchAll(reset(NUMBER_RE))) {
    if (match.index == null || insideCitation(text, match.index, match.index + match[0].length)) continue
    if (hasNumber(allowed, match[0])) return true
  }
  const folded = fold(text)
  return sources.some((source) => {
    const phrase = fold(source)
    return phrase.length >= 12 && folded.includes(phrase)
  })
}

export function verifyGroundedAnswer(input: {
  answer: string
  question: string
  records: SourceRecord[]
  now?: number
}): { text: string; blocked: string[] } {
  const now = input.now ?? Date.now()
  const topic = claimTopic(input.question)
  const allowedRecords = authorizing(input.records, topic, now)
  const allowed = fold(allowedRecords.map((record) => `${record.text}\n${record.url}\n${record.asOf ?? ''}`).join('\n'))
  const sources = allowedRecords.map((record) => record.text)
  const body = hideCacheLabel(input.answer)
  const spans: Span[] = []
  const blocked: string[] = []
  const push = (start: number, end: number, token: string) => {
    if (!token || covered(spans, start, end)) return
    spans.push({ start, end, token })
    blocked.push(token)
  }
  for (const match of body.matchAll(reset(DATE_RE))) {
    const date = match[1] ?? match[0]
    if (match.index == null || has(allowed, date)) continue
    push(match.index, match.index + match[0].length, date)
  }
  for (const match of body.matchAll(reset(URL_RE))) {
    const url = match[0].replace(/[.,]+$/, '')
    if (match.index == null || has(allowed, url)) continue
    push(match.index, match.index + url.length, url)
  }
  for (const match of body.matchAll(reset(SECTION_RE))) {
    if (match.index == null || has(allowed, match[0])) continue
    push(match.index, match.index + match[0].length, match[0])
  }
  for (const match of body.matchAll(reset(QUOTE_RE))) {
    const quote = match[1]
    if (match.index == null || !quote || has(allowed, quote)) continue
    push(match.index, match.index + match[0].length, quote)
  }
  for (const match of body.matchAll(reset(MONEY_RE))) {
    const token = match[0]
    const numeric = token.replace(/[^\d.]/g, '')
    if (match.index == null) continue
    if (has(allowed, token) || hasNumber(allowed, numeric)) continue
    push(match.index, match.index + token.length, token)
  }
  for (const match of body.matchAll(reset(NUMBER_RE))) {
    if (match.index == null) continue
    const start = match.index
    const end = start + match[0].length
    if (insideCitation(body, start, end) || covered(spans, start, end)) continue
    if (hasNumber(allowed, match[0])) continue
    push(start, end, match[0])
  }
  const freshCache = input.records.find((record) => marketKind(record.kind) && record.cachedAt != null && !record.stale && now - record.cachedAt <= ageLimit(record.kind, topic))
  const saysLive = /\blive\b|as of today|current price|right now/i.test(body)
  if (freshCache?.cachedAt != null && saysLive) blocked.push('cached-as-live')
  const replacement = () => unableMessage(topic ?? (blocked.some((item) => /section/i.test(item)) ? 'legal' : 'fact'))
  if (blocked.includes('cached-as-live') || (spans.length > 0 && !hasGroundedClaim(removeSpans(body, spans), allowed, sources))) {
    return { text: replacement(), blocked }
  }
  if (spans.length) {
    const kept = removeSpans(body, spans)
    if (freshCache?.cachedAt != null) return { text: `${kept}\n${cacheLabel(freshCache.cachedAt)}`, blocked: [] }
    return { text: kept, blocked: [] }
  }
  const stripped = withoutCacheLabel(input.answer)
  if (freshCache?.cachedAt != null) {
    return { text: `${stripped}\n${cacheLabel(freshCache.cachedAt)}`, blocked: [] }
  }
  return { text: stripped, blocked: [] }
}
