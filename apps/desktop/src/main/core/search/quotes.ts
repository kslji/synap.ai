/**
 * On-demand public quote pages. One fetch per provider when the user asks.
 * A hit is kept on disk for 60 seconds. Nothing polls in the background.
 */
import { createHash } from 'node:crypto'
import type { Citation } from '../ipc-contract.js'
import type { DB } from '../db.js'
import type { PoliteOpts } from './http.js'
import { politeFetch } from './http.js'
import { regionBanner } from './region.js'
import { FINANCE_DISCLAIMER } from './finance.js'
import { STOCK_MAX_AGE_MS, sourceUsable } from './verify-answer.js'
import type { RegionChoice } from './types.js'
import {
  providerSymbol,
  providersForRegion,
  quotePriceShown,
  reportedPriceLine,
  type QuoteProvider,
} from '../../../shared/quote.js'

export const QUOTE_TTL_MS = 60 * 1000

export const QUOTE_CACHE_MIGRATION = `
CREATE TABLE IF NOT EXISTS quote_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`

export interface QuoteHit {
  name: string
  url: string
  price: string
}

export interface QuoteSnapshot {
  symbol: string
  price: string
  asOf: string
  timeZone: string
  fetchedAt: number
  hits: QuoteHit[]
}

function quoteKey(region: string, symbol: string): string {
  return createHash('sha256').update(`quote\n${region}\n${symbol.toUpperCase()}`).digest('hex')
}

export function readQuoteCache(db: DB | null, region: string, symbol: string, now: number): QuoteSnapshot | null {
  if (!db) return null
  const row = db.prepare('SELECT payload, expires_at AS expiresAt FROM quote_cache WHERE cache_key = ?').get(quoteKey(region, symbol)) as { payload: string; expiresAt: number } | undefined
  if (!row) return null
  if (row.expiresAt <= now) {
    db.prepare('DELETE FROM quote_cache WHERE cache_key = ?').run(quoteKey(region, symbol))
    return null
  }
  try {
    const parsed = JSON.parse(row.payload) as QuoteSnapshot
    if (!parsed?.price || !parsed.asOf || !parsed.hits?.length) return null
    return parsed
  } catch {
    return null
  }
}

export function writeQuoteCache(db: DB | null, region: string, symbol: string, snapshot: QuoteSnapshot, now: number): void {
  if (!db) return
  const payload = JSON.stringify(snapshot)
  db.prepare(
    `INSERT INTO quote_cache (cache_key, payload, fetched_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
  ).run(quoteKey(region, symbol), payload, now, now + QUOTE_TTL_MS)
}

interface FetchedQuote extends QuoteHit {
  asOf: string
}

function pickGroup(hits: FetchedQuote[]): FetchedQuote[] {
  const groups = new Map<string, FetchedQuote[]>()
  for (const hit of hits) {
    const group = groups.get(hit.price) ?? []
    group.push(hit)
    groups.set(hit.price, group)
  }
  let best: FetchedQuote[] = []
  for (const group of groups.values()) {
    if (group.length > best.length) best = group
  }
  return best
}

export async function readLiveQuote(input: {
  symbol: string
  region: RegionChoice
  now: number
  db: DB | null
  offlineOnly: boolean
  webAllowed: boolean
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeZone: string
  providers?: QuoteProvider[]
}): Promise<QuoteSnapshot | null> {
  const cached = readQuoteCache(input.db, input.region.code, input.symbol, input.now)
  if (cached) return cached
  if (input.offlineOnly || !input.webAllowed) return null
  const providers = providersForRegion(input.region.code, input.providers)
  const hits: FetchedQuote[] = []
  for (const provider of providers) {
    const symbol = providerSymbol(provider.id, input.symbol, input.region.code)
    const url = provider.pageUrl(symbol)
    const res = await politeFetch(url, {
      offlineOnly: input.offlineOnly,
      fetchImpl: input.fetchImpl,
      signal: input.signal,
      timeoutMs: 8000,
      perMinute: 4,
      headers: { accept: 'text/html' },
    } satisfies PoliteOpts)
    if (!res) continue
    const html = await res.text()
    const parsed = provider.parse(html)
    if (!parsed || !sourceUsable(parsed.asOf, input.now, STOCK_MAX_AGE_MS)) continue
    hits.push({ name: provider.name, url, price: parsed.price, asOf: parsed.asOf })
  }
  const group = pickGroup(hits)
  const first = group[0]
  if (!first) return null
  const snapshot: QuoteSnapshot = {
    symbol: input.symbol.toUpperCase(),
    price: first.price,
    asOf: first.asOf,
    timeZone: input.timeZone,
    fetchedAt: input.now,
    hits: group.map((hit) => ({ name: hit.name, url: hit.url, price: hit.price })),
  }
  writeQuoteCache(input.db, input.region.code, input.symbol, snapshot, input.now)
  return snapshot
}

export function quoteAnswer(snapshot: QuoteSnapshot, region: RegionChoice): { text: string; citations: Citation[] } {
  const line = reportedPriceLine(snapshot.asOf, snapshot.timeZone)
  const marks = snapshot.hits.map((_, index) => `[S${index + 1}]`).join(' ')
  const excerpt = `${snapshot.symbol} ${snapshot.price}. ${line}. ${snapshot.asOf}`
  const text = [
    regionBanner(region.label),
    `${snapshot.symbol} ${snapshot.price}.`,
    `${line} ${marks}.`,
    FINANCE_DISCLAIMER,
  ].join('\n')
  if (!quotePriceShown(text, snapshot.price)) {
    return { text: '', citations: [] }
  }
  return {
    text,
    citations: snapshot.hits.map((hit) => ({
      kind: 'web' as const,
      title: hit.name,
      url: hit.url,
      pack: 'quote',
      domain: domainOf(hit.url),
      published: snapshot.asOf,
      excerpt: `${excerpt}\n${hit.name}\n${hit.url}`,
    })),
  }
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

export function quoteCacheStats(db: DB | null): { bytes: number; count: number } {
  if (!db) return { bytes: 0, count: 0 }
  try {
    const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(payload)), 0) AS bytes FROM quote_cache').get() as { count: number; bytes: number }
    return { bytes: Number(row.bytes) || 0, count: Number(row.count) || 0 }
  } catch {
    return { bytes: 0, count: 0 }
  }
}

export function clearQuoteCache(db: DB | null): void {
  if (!db) return
  try { db.prepare('DELETE FROM quote_cache').run() } catch { /* older databases have no quote table */ }
}
