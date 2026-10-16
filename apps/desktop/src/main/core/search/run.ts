/**
 * Production search. Official connectors first, DuckDuckGo lite only if they return nothing.
 * Finance and legal answers are composed here so the model does not invent a figure or a section.
 */
import type { Citation } from '../ipc-contract.js'
import type { DB } from '../db.js'
import { dropBlocked } from './blocked.js'
import { readCacheMeta, writeCache } from './cache.js'
import { runConnectors } from './connectors.js'
import { searchDdg } from './ddg.js'
import {
  coinAnswer,
  coinId,
  eodAnswer,
  feedAnswer,
  fetchCoin,
  fetchOfficialEod,
  findNav,
  navAnswer,
  navQuery,
  parseAmfiNav,
  parsePnlQuestion,
  parseRss,
  parseSipQuestion,
  pnlAnswer,
  sipAnswer,
  RBI_RSS,
  SEBI_RSS,
  stockSymbol,
  taxAnswer,
  unavailableFinance,
  type FinanceAnswer,
  AMFI_NAV_URL,
} from './finance.js'
import { politeFetch } from './http.js'
import { classifyIntent, financeNeedsLive } from './intent.js'
import { legalAnswer, legalUnavailable, quoteFromHits, searchLegalWeb } from './legal.js'
import { quoteAnswer, readLiveQuote } from './quotes.js'
import { readPage } from './reader.js'
import type { ConnectorHit, LocalHit, RegionChoice } from './types.js'
import { quotePriceShown } from '../../../shared/quote.js'
import {
  NAV_MAX_AGE_MS,
  NEWS_MAX_AGE_MS,
  PRICE_MAX_AGE_MS,
  STOCK_MAX_AGE_MS,
  claimTopic,
  recordsFromCitations,
  sourceUsable,
  unableMessage,
  verifyGroundedAnswer,
} from './verify-answer.js'
import { regionBanner } from './region.js'

export interface ComposedAnswer {
  text: string
  citations: Citation[]
  gate: 'answer' | 'insufficient'
}

type Net = { offlineOnly: boolean; fetchImpl?: typeof fetch; signal?: AbortSignal }

function asFinance(answer: FinanceAnswer, gate: ComposedAnswer['gate'] = 'answer'): ComposedAnswer {
  return { text: answer.text, citations: answer.citations, gate }
}

function publishFinance(question: string, region: RegionChoice, answer: FinanceAnswer, kind: 'math' | 'crypto' | 'nav' | 'news' | 'stock', now: number): ComposedAnswer {
  const checked = verifyGroundedAnswer({
    answer: answer.text,
    question,
    records: recordsFromCitations(answer.citations, kind),
    now,
  })
  const fallback = kind === 'news' ? 'news' : 'price'
  if (checked.blocked.length) return asFinance(unavailableFinance(region, fallback), 'insufficient')
  return { text: checked.text, citations: answer.citations, gate: 'answer' }
}

/** A web search that came back empty. A price, news, or legal question gets the unable message. */
export function emptyWebAnswer(question: string, region: RegionChoice, fallback: string): string {
  const topic = claimTopic(question)
  if (!topic) return fallback
  return `${regionBanner(region.label)}\n${unableMessage(topic)}`
}

export async function composeRouted(input: {
  question: string
  hits: LocalHit[]
  region: RegionChoice
  offlineOnly: boolean
  webAllowed: boolean
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  navText?: string
  bhavText?: string
  now?: number
  db?: DB | null
  timeZone?: string
}): Promise<ComposedAnswer | null> {
  const intent = classifyIntent(input.question)
  const net: Net = { offlineOnly: input.offlineOnly, fetchImpl: input.fetchImpl, signal: input.signal }
  const now = input.now ?? Date.now()
  if (intent === 'finance') return composeFinance(input.question, input.region, input.webAllowed, net, now, input.navText, input.bhavText, input.db ?? null, input.timeZone)
  if (intent === 'legal') return composeLegal(input.question, input.hits, input.region, input.webAllowed, net, now)
  return null
}

function stockQuestion(question: string): boolean {
  return /\b(nse|bse|stock price|share price|nifty|sensex)\b/i.test(question)
}

async function composeQuote(question: string, region: RegionChoice, webAllowed: boolean, net: Net, now: number, db: DB | null, timeZone: string | undefined): Promise<ComposedAnswer> {
  const symbol = stockSymbol(question)
  if (!symbol) return asFinance(unavailableFinance(region, 'price'), 'insufficient')
  const snapshot = await readLiveQuote({
    symbol,
    region,
    now,
    db,
    offlineOnly: net.offlineOnly,
    webAllowed,
    fetchImpl: net.fetchImpl,
    signal: net.signal,
    timeZone: timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  if (!snapshot) return asFinance(unavailableFinance(region, 'price'), 'insufficient')
  const answer = quoteAnswer(snapshot, region)
  const excerpts = answer.citations.map((item) => item.excerpt || '').join('\n')
  if (!answer.text || !quotePriceShown(answer.text, snapshot.price) || !quotePriceShown(excerpts, snapshot.price)) {
    return asFinance(unavailableFinance(region, 'price'), 'insufficient')
  }
  return publishFinance(question, region, answer, 'stock', now)
}

async function composeFinance(question: string, region: RegionChoice, webAllowed: boolean, net: Net, now: number, navText?: string, bhavText?: string, db: DB | null = null, timeZone?: string): Promise<ComposedAnswer> {
  const sip = parseSipQuestion(question)
  if (sip) return publishFinance(question, region, sipAnswer(sip, region), 'math', now)
  const pnl = parsePnlQuestion(question)
  if (pnl) return publishFinance(question, region, pnlAnswer(pnl, region), 'math', now)
  const tax = question.match(/\b(stcg|ltcg|capital gain)\b/i)
  if (tax) {
    const gain = Number(question.match(/(\d+(?:\.\d+)?)\s*(?:inr|rupees|rs)?/i)?.[1] ?? '0')
    const days = Number(question.match(/(\d+)\s*days?/i)?.[1] ?? (/\bltcg\b/i.test(question) ? '400' : '10'))
    const india = region.code === 'IN' || /\bindia\b/i.test(question)
    return publishFinance(question, region, taxAnswer(gain, days, region, india), 'math', now)
  }
  if (stockQuestion(question) && !bhavText) return composeQuote(question, region, webAllowed, net, now, db, timeZone)
  if (!webAllowed || net.offlineOnly || !financeNeedsLive(question)) {
    return asFinance(unavailableFinance(region, 'price'), 'insufficient')
  }
  const coin = coinId(question)
  if (coin) {
    const price = await fetchCoin(coin, net)
    if (!price || !sourceUsable(price.at, now, PRICE_MAX_AGE_MS)) return asFinance(unavailableFinance(region, 'price'), 'insufficient')
    return publishFinance(question, region, coinAnswer(coin, price, region), 'crypto', now)
  }
  if (region.code === 'IN' && /\b(nav|amfi|mutual fund)\b/i.test(question)) {
    const text = navText ?? await (async () => {
      const res = await politeFetch(AMFI_NAV_URL, { ...net, timeoutMs: 8000, perMinute: 4, headers: { accept: 'text/plain' } })
      return res ? res.text() : null
    })()
    const row = text ? findNav(parseAmfiNav(text), navQuery(question)) : null
    if (!row || !sourceUsable(row.date, now, NAV_MAX_AGE_MS)) return asFinance(unavailableFinance(region, 'price'), 'insufficient')
    return publishFinance(question, region, navAnswer(row, region), 'nav', now)
  }
  if (/\b(sebi|rbi|circular)\b/i.test(question)) {
    const feeds = [
      { name: 'RBI press releases', url: RBI_RSS },
      { name: 'SEBI', url: SEBI_RSS },
    ]
    for (const feed of feeds) {
      const res = await politeFetch(feed.url, { ...net, perMinute: 4, headers: { accept: 'application/rss+xml, application/xml, text/xml' } })
      const items = res ? parseRss(await res.text()).filter((item) => sourceUsable(item.date, now, NEWS_MAX_AGE_MS)) : []
      if (items.length) return publishFinance(question, region, feedAnswer(feed.name, feed.url, items, region), 'news', now)
    }
    return asFinance(unavailableFinance(region, 'news'), 'insufficient')
  }
  if (stockQuestion(question)) {
    if (region.code !== 'IN' && !/\b(nse|bse|india)\b/i.test(question)) {
      return asFinance(unavailableFinance(region, 'price'), 'insufficient')
    }
    const symbol = stockSymbol(question)
    if (!symbol) return asFinance(unavailableFinance(region, 'price'), 'insufficient')
    const row = await fetchOfficialEod(symbol, net, bhavText)
    if (!row || !sourceUsable(row.date, now, STOCK_MAX_AGE_MS)) return asFinance(unavailableFinance(region, 'price'), 'insufficient')
    return publishFinance(question, region, eodAnswer(row, region), 'stock', now)
  }
  return asFinance(unavailableFinance(region, 'price'), 'insufficient')
}

async function composeLegal(question: string, hits: LocalHit[], region: RegionChoice, webAllowed: boolean, net: Net, now: number): Promise<ComposedAnswer> {
  const local = quoteFromHits(question, hits)
  if (local) return publishLegal(question, region, legalAnswer(local, region), now)
  if (webAllowed && !net.offlineOnly) {
    const remote = await searchLegalWeb(question, region, net)
    if (remote?.text) return publishLegal(question, region, legalAnswer(remote, region), now)
  }
  return { ...legalUnavailable(region), gate: 'insufficient' }
}

function publishLegal(question: string, region: RegionChoice, answer: { text: string; citations: Citation[] }, now: number): ComposedAnswer {
  const checked = verifyGroundedAnswer({
    answer: answer.text,
    question,
    records: recordsFromCitations(answer.citations, 'legal'),
    now,
  })
  if (checked.blocked.length) return { ...legalUnavailable(region), gate: 'insufficient' }
  return { text: checked.text, citations: answer.citations, gate: 'answer' }
}

export interface GatheredPage {
  url: string
  title: string
  text: string
  published: string | null
  source: string
  cachedAt: number | null
}

export async function gatherOnline(input: {
  question: string
  region: RegionChoice
  offlineOnly: boolean
  db: DB | null
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  jsRender?: (url: string) => Promise<string | null>
  now?: number
}): Promise<{ hits: ConnectorHit[]; pages: GatheredPage[] }> {
  const intent = classifyIntent(input.question)
  const ctx = { offlineOnly: input.offlineOnly, fetchImpl: input.fetchImpl, signal: input.signal }
  const now = input.now ?? Date.now()
  const cached = readCacheMeta(input.db, 'search', input.region.code, input.question, now)
  let hits: ConnectorHit[] = []
  if (cached) {
    try { hits = JSON.parse(cached.payload) as ConnectorHit[] } catch { hits = [] }
    hits = hits.map((hit) => ({ ...hit, cachedAt: cached.fetchedAt }))
  }
  if (!hits.length) {
    try { hits = await runConnectors(intent, input.question, ctx) } catch { hits = [] }
    if (!hits.length) {
      try { hits = await searchDdg(input.question, ctx) } catch { hits = [] }
    }
    hits = dropBlocked(hits)
    if (hits.length) writeCache(input.db, 'search', input.region.code, input.question, JSON.stringify(hits), now)
  } else {
    hits = dropBlocked(hits)
  }
  const pages: GatheredPage[] = []
  for (const hit of hits.slice(0, 3)) {
    const cachedPage = readCacheMeta(input.db, 'page', input.region.code, hit.url, now)
    if (cachedPage) {
      pages.push({ url: hit.url, title: hit.title, text: cachedPage.payload, published: hit.published, source: hit.source, cachedAt: cachedPage.fetchedAt })
      continue
    }
    const page = await readPage(hit.url, { ...ctx, jsRender: input.jsRender }).catch(() => null)
    const text = page?.markdown || hit.snippet
    if (!text.trim()) continue
    if (page?.markdown) writeCache(input.db, 'page', input.region.code, hit.url, page.markdown, now)
    pages.push({ url: hit.url, title: page?.title || hit.title, text, published: hit.published, source: hit.source, cachedAt: hit.cachedAt ?? null })
  }
  return { hits, pages }
}
