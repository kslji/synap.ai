/**
 * Legal answers quote a source and say they are not legal advice.
 * India Code is one provider. Another country is another provider in this list.
 */
import type { Citation } from '../ipc-contract.js'
import { politeFetch, type PoliteOpts } from './http.js'
import { regionBanner } from './region.js'
import type { LocalHit, RegionChoice } from './types.js'

export const LEGAL_DISCLAIMER = 'This is not legal advice.'

export interface LegalHit {
  title: string
  url: string
  text: string
  pack: string
  version?: string
}

export interface LegalProvider {
  id: string
  /** ISO codes, or '*' for every region. */
  regions: string[]
  searchUrl: (query: string) => string
  parse: (html: string, pageUrl: string) => LegalHit[]
}

export function indiaCodeSearchUrl(query: string): string {
  return `https://www.indiacode.nic.in/simple-search?query=${encodeURIComponent(query)}&rpp=5&sort_by=score&order=desc`
}

export function parseIndiaCode(html: string, pageUrl: string): LegalHit[] {
  const rows: LegalHit[] = []
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(linkRe)) {
    const href = match[1]
    const title = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!title || !/indiacode\.nic\.in|\/handle\/|\/bitstream\//i.test(href + pageUrl)) continue
    let url = href
    try { url = new URL(href, pageUrl).toString() } catch { /* keep href */ }
    const after = html.slice(match.index ?? 0, (match.index ?? 0) + 800)
    const section = after.match(/section\s+\d+[a-z]?[\s\S]{0,400}/i)?.[0]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!url.startsWith('http')) continue
    rows.push({ title, url, text: section || '', pack: 'india-code' })
    if (rows.length >= 3) break
  }
  return rows
}

export const INDIA_CODE: LegalProvider = {
  id: 'india-code',
  regions: ['IN'],
  searchUrl: indiaCodeSearchUrl,
  parse: parseIndiaCode,
}

export const LEGAL_PROVIDERS: LegalProvider[] = [INDIA_CODE]

export function providersFor(region: string, providers: LegalProvider[] = LEGAL_PROVIDERS): LegalProvider[] {
  const code = region.toUpperCase()
  return providers.filter((provider) => provider.regions.includes('*') || provider.regions.includes(code))
}

export function sectionNumber(question: string): string | null {
  return question.match(/\bsection\s+(\d+[a-z]?)\b/i)?.[1] ?? null
}

export function quoteFromHits(question: string, hits: LocalHit[]): LegalHit | null {
  const want = sectionNumber(question)
  const pool = hits.filter((hit) => hit.text.trim())
  const found = pool.find((hit) => {
    if (want && new RegExp(`section\\s+${want}\\b`, 'i').test(hit.text)) return true
    return false
  }) ?? (want ? null : pool.find((hit) => /\bsection\s+\d+/i.test(hit.text)) ?? null)
  if (!found) return null
  const match = want ? found.text.match(new RegExp(`section\\s+${want}\\b[\\s\\S]{0,500}`, 'i')) : null
  const text = (match?.[0] || found.text).replace(/\s+/g, ' ').trim().slice(0, 500)
  return { title: found.title || found.fileName || found.pack, url: found.url || '', text, pack: found.pack, version: found.version }
}

export function legalAnswer(quote: LegalHit, region: RegionChoice): { text: string; citations: Citation[] } {
  const versionLine = quote.version ? `Packs: ${quote.pack.includes(quote.version) ? quote.pack : `${quote.pack} ${quote.version}`}.` : ''
  const excerpt = quote.text
  const citation: Citation = {
    kind: quote.url.startsWith('http') ? 'web' : 'document',
    title: quote.title,
    url: quote.url,
    pack: quote.pack,
    version: quote.version,
    excerpt,
  }
  return {
    text: [
      regionBanner(region.label),
      `${excerpt} [S1]`,
      versionLine,
      LEGAL_DISCLAIMER,
    ].filter(Boolean).join('\n'),
    citations: [citation],
  }
}

export function legalUnavailable(region: RegionChoice): { text: string; citations: Citation[] } {
  return {
    text: [
      regionBanner(region.label),
      'I don\'t have that section in the sources on this computer.',
      LEGAL_DISCLAIMER,
    ].join('\n'),
    citations: [],
  }
}

export async function searchLegalWeb(question: string, region: RegionChoice, opts: Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'>, providers = LEGAL_PROVIDERS): Promise<LegalHit | null> {
  for (const provider of providersFor(region.code, providers)) {
    try {
      const url = provider.searchUrl(question)
      const res = await politeFetch(url, { ...opts, perMinute: 6, headers: { accept: 'text/html' } })
      if (!res) continue
      const html = await res.text()
      const rows = provider.parse(html, url)
      const want = sectionNumber(question)
      const picked = rows.find((row) => row.text && (!want || new RegExp(`section\\s+${want}\\b`, 'i').test(row.text))) ?? rows.find((row) => row.text)
      if (picked) return picked
    } catch {
      /* next provider */
    }
  }
  return null
}
