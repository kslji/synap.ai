import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openUserDb } from '../db.js'
import { LIBRARY_MIGRATION } from '../library-schema.js'
import { SESSION_MIGRATION } from '../session-store.js'
import { WEB_CACHE_MIGRATION } from '../web-cache.js'
import { SEARCH_CACHE_MIGRATION } from './cache.js'
import { resetRateLimits } from './http.js'
import { composeRouted } from './run.js'
import { QUOTE_CACHE_MIGRATION, QUOTE_TTL_MS, readLiveQuote, readQuoteCache } from './quotes.js'
import { UNABLE_PRICE, recordsFromCitations, verifyGroundedAnswer } from './verify-answer.js'
import {
  formatQuoteAsOf,
  parseClockText,
  parseEtQuote,
  parseMoneycontrolQuote,
  parseYahooQuote,
  providerSymbol,
  providersForRegion,
  quoteChipLabel,
  quoteChips,
  quotePriceShown,
  reportedPriceLine,
  QUOTE_PROVIDERS,
} from '../../../shared/quote.js'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')
const KEY = 'ab'.repeat(32)
const INDIA = { code: 'IN', label: 'India', source: 'question' as const }
const WORLD = { code: 'GLOBAL', label: 'worldwide sources', source: 'global' as const }

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'surf-quote-'))
  const handle = openUserDb(join(dir, 'user.db'), KEY, [SESSION_MIGRATION, LIBRARY_MIGRATION, WEB_CACHE_MIGRATION, SEARCH_CACHE_MIGRATION, QUOTE_CACHE_MIGRATION])
  return { dir, handle }
}

function yahooHtml(price: string, unix: number): string {
  return `<html><body><fin-streamer data-symbol="AAPL" data-field="regularMarketPrice" data-value="1"> ${price} </fin-streamer><fin-streamer data-field="regularMarketTime" data-value="${unix}"></fin-streamer></body></html>`
}

test('quote pages extract the displayed price and its timestamp', () => {
  const yahoo = parseYahooQuote(yahooHtml('4,010.50', NOW / 1000))
  assert.equal(yahoo?.price, '4,010.50')
  assert.equal(yahoo?.asOf, '2026-10-16T12:00:00.000Z')
  assert.equal(parseYahooQuote('<fin-streamer data-field="regularMarketPrice">4,010.50</fin-streamer>'), null)

  const et = parseEtQuote('<span class="ltp">4,010.50</span><span class="updateTime">As on 16 Oct, 2026 17:30 IST</span>')
  assert.equal(et?.price, '4,010.50')
  assert.equal(et?.asOf, '2026-10-16T12:00:00.000Z')
  assert.equal(parseClockText('16 Oct 2026, 17:30 IST'), '2026-10-16T12:00:00.000Z')

  const mc = parseMoneycontrolQuote('<div id="nsecp" class="inprice1">189.25</div><time datetime="2026-10-16T12:00:00.000Z">16 Oct, 17:30</time>')
  assert.equal(mc?.price, '189.25')
  assert.equal(mc?.asOf, '2026-10-16T12:00:00.000Z')
  assert.equal(parseMoneycontrolQuote('<div id="nsecp">189.25</div>'), null)
})

test('quote providers are public pages, region-aware, and not a hidden JSON API', () => {
  assert.deepEqual(providersForRegion('IN').map((item) => item.id), ['et', 'moneycontrol', 'yahoo'])
  assert.deepEqual(providersForRegion('US').map((item) => item.id), ['yahoo'])
  assert.equal(providerSymbol('yahoo', 'TCS', 'IN'), 'TCS.NS')
  assert.equal(providerSymbol('et', 'TCS.NS', 'IN'), 'TCS')
  for (const provider of QUOTE_PROVIDERS) {
    const url = provider.pageUrl('TCS')
    assert.equal(url.startsWith('https://'), true)
    assert.equal(/query1\.finance\.yahoo|yfinance|\/v8\/finance/i.test(url), false)
  }
  assert.equal(QUOTE_TTL_MS, 60_000)
})

test('quote chips are the site name plus the source number', () => {
  const chips = quoteChips([
    { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/quote/AAPL' },
    { name: 'ET Markets', url: 'https://economictimes.indiatimes.com/markets/stocks/stock-quotes/TCS' },
  ])
  assert.equal(quoteChipLabel('Yahoo Finance', 1), 'Yahoo Finance +1')
  assert.deepEqual(chips.map((chip) => chip.label), ['Yahoo Finance +1', 'ET Markets +2'])
  assert.equal(chips[0]?.url, 'https://finance.yahoo.com/quote/AAPL')
  assert.equal(chips[1]?.url.includes('economictimes.indiatimes.com'), true)
})

test('a quote is cached for 60 seconds and then refetched', async () => {
  const { dir, handle } = db()
  try {
    resetRateLimits()
    let calls = 0
    let price = '189.25'
    const fetchImpl: typeof fetch = async (url) => {
      calls += 1
      assert.equal(String(url), 'https://finance.yahoo.com/quote/AAPL')
      return new Response(yahooHtml(price, NOW / 1000), { status: 200 })
    }
    const first = await readLiveQuote({ symbol: 'AAPL', region: WORLD, now: NOW, db: handle, offlineOnly: false, webAllowed: true, fetchImpl, timeZone: 'UTC' })
    const second = await readLiveQuote({ symbol: 'AAPL', region: WORLD, now: NOW + 30_000, db: handle, offlineOnly: false, webAllowed: true, fetchImpl, timeZone: 'UTC' })
    assert.equal(calls, 1)
    assert.equal(second?.price, '189.25')
    assert.equal(second?.asOf, first?.asOf)
    assert.equal(readQuoteCache(handle, 'GLOBAL', 'AAPL', NOW + 30_000)?.price, '189.25')
    const expired = NOW + QUOTE_TTL_MS + 1_000
    const offline = await readLiveQuote({ symbol: 'AAPL', region: WORLD, now: expired, db: handle, offlineOnly: true, webAllowed: true, fetchImpl, timeZone: 'UTC' })
    assert.equal(offline, null)
    assert.equal(calls, 1)
    price = '190.10'
    const third = await readLiveQuote({ symbol: 'AAPL', region: WORLD, now: expired, db: handle, offlineOnly: false, webAllowed: true, fetchImpl, timeZone: 'UTC' })
    assert.equal(calls, 2)
    assert.equal(third?.price, '190.10')
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a shown quote that does not match the page is replaced', async () => {
  resetRateLimits()
  const answer = await composeRouted({
    question: 'What is the stock price of AAPL?',
    hits: [],
    region: WORLD,
    offlineOnly: false,
    webAllowed: true,
    now: NOW,
    timeZone: 'UTC',
    fetchImpl: async () => new Response(yahooHtml('189.25', NOW / 1000), { status: 200 }),
  })
  assert.ok(answer)
  assert.equal(answer.text.includes('189.25'), true)
  assert.equal(answer.text.includes(reportedPriceLine('2026-10-16T12:00:00.000Z', 'UTC')), true)
  assert.equal(answer.citations[0]?.title, 'Yahoo Finance')
  assert.equal(answer.citations[0]?.url, 'https://finance.yahoo.com/quote/AAPL')
  assert.equal(answer.citations[0]?.pack, 'quote')
  assert.equal(quotePriceShown(answer.text, '189.25'), true)
  assert.equal(formatQuoteAsOf('2026-10-16T12:00:00.000Z', 'UTC').includes('16 Oct 2026'), true)

  const mismatched = verifyGroundedAnswer({
    answer: 'AAPL is 9999.00 right now.',
    question: 'What is the stock price of AAPL?',
    records: recordsFromCitations(answer.citations, 'stock'),
    now: NOW,
  })
  assert.equal(mismatched.text, UNABLE_PRICE)
  assert.equal(mismatched.text.includes('9999'), false)
  assert.equal(mismatched.text.includes('189.25'), false)
})

test('a comma price from an India page is shown unchanged', async () => {
  resetRateLimits()
  const html = '<span class="ltp">4,010.50</span><time datetime="2026-10-16T12:00:00.000Z">16 Oct 2026, 17:30 IST</time>'
  const answer = await composeRouted({
    question: 'What is the NSE stock price of TCS?',
    hits: [],
    region: INDIA,
    offlineOnly: false,
    webAllowed: true,
    now: NOW,
    timeZone: 'Asia/Kolkata',
    fetchImpl: async (url) => {
      const value = String(url)
      if (value.includes('economictimes.indiatimes.com')) return new Response(html, { status: 200 })
      return new Response('', { status: 404 })
    },
  })
  assert.ok(answer)
  assert.equal(answer.text.includes('4,010.50'), true)
  assert.equal(answer.text.includes(UNABLE_PRICE), false)
  assert.equal(answer.citations.some((item) => item.url.includes('economictimes.indiatimes.com/markets/stocks/stock-quotes/TCS')), true)
  assert.equal(answer.text.includes('200.00'), false)
})
