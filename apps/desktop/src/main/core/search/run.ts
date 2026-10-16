/**
 * Production search. Official connectors first, DuckDuckGo lite only if they return nothing.
 * Finance and legal answers are composed here so the model does not invent a figure or a section.
 */
import type { Citation } from '../ipc-contract.js'
import type { DB } from '../db.js'
import { dropBlocked } from './blocked.js'
import { readCache, writeCache } from './cache.js'
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
import { readPage } from './reader.js'
import type { ConnectorHit, LocalHit, RegionChoice } from './types.js'

export interface ComposedAnswer {
  text: string
  citations: Citation[]
  gate: 'answer' | 'insufficient'
}

type Net = { offlineOnly: boolean; fetchImpl?: typeof fetch; signal?: AbortSignal }

function asFinance(answer: FinanceAnswer, gate: ComposedAnswer['gate'] = 'answer'): ComposedAnswer {
  return { text: answer.text, citations: answer.citations, gate }
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
}): Promise<ComposedAnswer | null> {
  const intent = classifyIntent(input.question)
  const net: Net = { offlineOnly: input.offlineOnly, fetchImpl: input.fetchImpl, signal: input.signal }
  if (intent === 'finance') return composeFinance(input.question, input.region, input.webAllowed, net, input.navText, input.bhavText)
  if (intent === 'legal') return composeLegal(input.question, input.hits, input.region, input.webAllowed, net)
  return null
}

async function composeFinance(question: string, region: RegionChoice, webAllowed: boolean, net: Net, navText?: string, bhavText?: string): Promise<ComposedAnswer> {
  const sip = parseSipQuestion(question)
  if (sip) return asFinance(sipAnswer(sip, region))
  const pnl = parsePnlQuestion(question)
  if (pnl) return asFinance(pnlAnswer(pnl, region))
  const tax = question.match(/\b(stcg|ltcg|capital gain)\b/i)
  if (tax) {
    const gain = Number(question.match(/(\d+(?:\.\d+)?)\s*(?:inr|rupees|rs)?/i)?.[1] ?? '0')
    const days = Number(question.match(/(\d+)\s*days?/i)?.[1] ?? (/\bltcg\b/i.test(question) ? '400' : '10'))
    const india = region.code === 'IN' || /\bindia\b/i.test(question)
    return asFinance(taxAnswer(gain, days, region, india))
  }
  if (!webAllowed || net.offlineOnly || !financeNeedsLive(question)) {
    return asFinance(unavailableFinance(region, 'That live figure'), 'insufficient')
  }
  const coin = coinId(question)
  if (coin) {
    const price = await fetchCoin(coin, net)
    if (!price) return asFinance(unavailableFinance(region, `${coin} price`), 'insufficient')
    return asFinance(coinAnswer(coin, price, region))
  }
  if (region.code === 'IN' && /\b(nav|amfi|mutual fund)\b/i.test(question)) {
    const text = navText ?? await (async () => {
      const res = await politeFetch(AMFI_NAV_URL, { ...net, timeoutMs: 8000, perMinute: 4, headers: { accept: 'text/plain' } })
      return res ? res.text() : null
    })()
    const row = text ? findNav(parseAmfiNav(text), question.replace(/\b(amfi|nav|of|the|fund|what|is)\b/gi, ' ').replace(/\s+/g, ' ').trim()) : null
    if (!row) return asFinance(unavailableFinance(region, 'AMFI NAV'), 'insufficient')
    return asFinance(navAnswer(row, region))
  }
  if (/\b(sebi|rbi|circular)\b/i.test(question)) {
    const feeds = [
      { name: 'RBI press releases', url: RBI_RSS },
      { name: 'SEBI', url: SEBI_RSS },
    ]
    for (const feed of feeds) {
      const res = await politeFetch(feed.url, { ...net, perMinute: 4, headers: { accept: 'application/rss+xml, application/xml, text/xml' } })
      const items = res ? parseRss(await res.text()) : []
      if (items.length) return asFinance(feedAnswer(feed.name, feed.url, items, region))
    }
    return asFinance(unavailableFinance(region, 'Official circular feed'), 'insufficient')
  }
  if (/\b(nse|bse|stock price|share price|nifty|sensex)\b/i.test(question)) {
    if (region.code !== 'IN' && !/\b(nse|bse|india)\b/i.test(question)) {
      return asFinance(unavailableFinance(region, 'End-of-day stock file for this region'), 'insufficient')
    }
    const symbol = stockSymbol(question)
    if (!symbol) return asFinance(unavailableFinance(region, 'Official end-of-day stock file'), 'insufficient')
    const row = await fetchOfficialEod(symbol, net, bhavText)
    if (!row) return asFinance(unavailableFinance(region, 'Official end-of-day stock file'), 'insufficient')
    return asFinance(eodAnswer(row, region))
  }
  return asFinance(unavailableFinance(region, 'That live figure'), 'insufficient')
}

async function composeLegal(question: string, hits: LocalHit[], region: RegionChoice, webAllowed: boolean, net: Net): Promise<ComposedAnswer> {
  const local = quoteFromHits(question, hits)
  if (local) return { ...legalAnswer(local, region), gate: 'answer' }
  if (webAllowed && !net.offlineOnly) {
    const remote = await searchLegalWeb(question, region, net)
    if (remote?.text) return { ...legalAnswer(remote, region), gate: 'answer' }
  }
  return { ...legalUnavailable(region), gate: 'insufficient' }
}

export interface GatheredPage {
  url: string
  title: string
  text: string
  published: string | null
  source: string
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
  const cached = readCache(input.db, 'search', input.region.code, input.question, now)
  let hits: ConnectorHit[] = []
  if (cached) {
    try { hits = JSON.parse(cached) as ConnectorHit[] } catch { hits = [] }
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
    const cachedPage = readCache(input.db, 'page', input.region.code, hit.url, now)
    if (cachedPage) {
      pages.push({ url: hit.url, title: hit.title, text: cachedPage, published: hit.published, source: hit.source })
      continue
    }
    const page = await readPage(hit.url, { ...ctx, jsRender: input.jsRender }).catch(() => null)
    const text = page?.markdown || hit.snippet
    if (!text.trim()) continue
    if (page?.markdown) writeCache(input.db, 'page', input.region.code, hit.url, page.markdown, now)
    pages.push({ url: hit.url, title: page?.title || hit.title, text, published: hit.published, source: hit.source })
  }
  return { hits, pages }
}
