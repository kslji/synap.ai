/**
 * When a chat may call the search service.
 * Local documents are never part of a search body. Only short rewritten queries leave the machine.
 */

export const SOURCE_REFUSAL = "I don't have enough information to answer that from the sources on this computer."
export const HINT_OFFLINE = 'Add a document. Turn on web search when you are online.'
export const HINT_WEB_OFF = 'Turn on web search, or add a document.'
export const HINT_FAILED = 'Add a document, or try web search again in a moment.'

const FRESH = /\b(latest|today|2026|price|prices)\b/i

export type LocalGate = 'answer' | 'borderline' | 'insufficient' | 'skip'
export type WebBranch = 'local' | 'web' | 'blend' | 'refuse'

export interface WebDecisionInput {
  local: LocalGate
  fresh: boolean
  online: boolean
  offlineOnly: boolean
  webAllowed: boolean
}

export function wantsFresh(text: string): boolean {
  return FRESH.test(text)
}

export function canSearchWeb(input: Pick<WebDecisionInput, 'online' | 'offlineOnly' | 'webAllowed'>): boolean {
  return input.online && !input.offlineOnly && input.webAllowed
}

export function refuseHint(input: Pick<WebDecisionInput, 'offlineOnly' | 'online'>): string {
  if (input.offlineOnly || !input.online) return HINT_OFFLINE
  return HINT_WEB_OFF
}

export function refusalMessage(hint: string): string {
  return `${SOURCE_REFUSAL} ${hint}`
}

/** Strong local hits stay on device. Fresh questions may add the web. Weak hits need the web or a refusal. */
export function decideWeb(input: WebDecisionInput): { branch: WebBranch; hint?: string } {
  const allowed = canSearchWeb(input)
  const strong = input.local === 'answer' || input.local === 'borderline'
  if (input.local === 'skip') {
    if (!input.fresh) return { branch: 'local' }
    if (allowed) return { branch: 'web' }
    return { branch: 'refuse', hint: refuseHint(input) }
  }
  if (strong && !input.fresh) return { branch: 'local' }
  if (strong && input.fresh && allowed) return { branch: 'blend' }
  if (strong) return { branch: 'local' }
  if (allowed) return { branch: 'web' }
  return { branch: 'refuse', hint: refuseHint(input) }
}

export function rewritePrompt(question: string): string {
  return [
    'Turn the question into 1 to 3 short web search queries.',
    'Keep names, places, and time words such as today or a year.',
    'Reply with JSON only: {"queries":["..."]}',
    `Question: ${question}`,
  ].join('\n')
}

function cleanQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}

function fromJson(raw: string): string[] | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced?.[1] ?? raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  const slice = start >= 0 && end > start ? body.slice(start, end + 1) : body.match(/\[[\s\S]*\]/)?.[0]
  if (!slice) return null
  try {
    const parsed = JSON.parse(slice) as { queries?: unknown } | unknown[]
    if (Array.isArray(parsed)) return parsed.map((item) => String(item))
    if (parsed && Array.isArray(parsed.queries)) return parsed.queries.map((item) => String(item))
  } catch {
    return null
  }
  return null
}

function fromLines(raw: string): string[] | null {
  const lines = raw
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 120 && !line.startsWith('{'))
  return lines.length ? lines : null
}

/** JSON object, fenced JSON, or a short numbered list. Otherwise the question itself. At most three. */
export function parseSearchQueries(raw: string, fallback: string): string[] {
  const found = fromJson(raw) ?? fromLines(raw) ?? []
  const cleaned = found.map(cleanQuery).filter(Boolean).slice(0, 3)
  if (cleaned.length) return cleaned
  const one = cleanQuery(fallback)
  return one ? [one] : []
}

/** The only JSON sent to POST /v1/search. Document text is not a field. */
export function searchBody(query: string, k = 5): { query: string; k: number } {
  return { query: cleanQuery(query).slice(0, 300), k: Math.min(8, Math.max(1, Math.round(k))) }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

export function prettyDate(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.replace(/\s+/g, ' ').trim().slice(0, 32)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** title · domain · date, the line shown on a web source card. */
export function formatWebCitation(item: { title: string; url: string; published?: string | null }): string {
  const domain = domainOf(item.url)
  const date = prettyDate(item.published)
  const title = item.title.trim() || domain || item.url
  return [title, domain, date].filter(Boolean).join(' · ')
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += a[i] * b[i]
  return sum
}

export interface Passage {
  text: string
  title: string
  url: string
  published: string | null
  vec: ArrayLike<number>
}

export function rankPassages<T extends Passage>(query: ArrayLike<number>, passages: T[], k = 4): Array<T & { cosine: number }> {
  return passages
    .map((passage) => ({ ...passage, cosine: cosine(query, passage.vec) }))
    .sort((a, b) => b.cosine - a.cosine)
    .slice(0, k)
}
