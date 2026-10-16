/**
 * Live figures come from the cited file or API. The model is not asked for the number.
 * Maths (return, XIRR, SIP, P&L, tax) runs here. Every figure names a date and a source.
 * This is not a recommendation to buy or sell.
 */
import JSZip from 'jszip'
import type { Citation } from '../ipc-contract.js'
import { politeFetch, type PoliteOpts } from './http.js'
import { regionBanner } from './region.js'
import type { RegionChoice } from './types.js'

export const FINANCE_DISCLAIMER = 'These figures are calculations from the cited source. This is not a recommendation to buy or sell.'

/**
 * Listed-equity rates bundled in the app. They are not fetched live.
 * Shown only when the question or the region is India. Not tax advice.
 */
export const INDIA_EQUITY_TAX = {
  asOf: '2024-07-23',
  source: 'Bundled calculation table dated 2024-07-23. Not a live statute fetch.',
  stcgRate: 0.2,
  ltcgRate: 0.125,
  ltcgExemptionInr: 125_000,
  longTermDays: 365,
} as const

export const AMFI_NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt'
export const COINGECKO_PRICE = 'https://api.coingecko.com/api/v3/simple/price'
export const RBI_RSS = 'https://www.rbi.org.in/pressreleases_rss.xml'
export const SEBI_RSS = 'https://www.sebi.gov.in/sebirss.xml'

export function simpleReturn(start: number, end: number): number {
  if (start === 0) throw new Error('start price is 0')
  return (end - start) / start
}

export function cagr(start: number, end: number, years: number): number {
  if (start <= 0 || years <= 0) throw new Error('cagr needs a positive start and years')
  return (end / start) ** (1 / years) - 1
}

/** End-of-month SIP. monthly * (((1+i)^n - 1) / i), i = annualRate/12. */
export function sipFutureValue(monthly: number, annualRate: number, months: number): number {
  if (monthly < 0 || months <= 0) throw new Error('sip needs a payment and at least one month')
  const i = annualRate / 12
  if (i === 0) return monthly * months
  return monthly * (((1 + i) ** months - 1) / i)
}

export function profitLoss(qty: number, buy: number, sell: number): { pnl: number; pct: number } {
  const pnl = (sell - buy) * qty
  const basis = buy * qty
  return { pnl, pct: basis === 0 ? 0 : pnl / basis }
}

export function indiaEquityTax(gain: number, holdingDays: number): { tax: number; rate: number; kind: 'stcg' | 'ltcg' } {
  if (holdingDays >= INDIA_EQUITY_TAX.longTermDays) {
    const taxable = Math.max(0, gain - INDIA_EQUITY_TAX.ltcgExemptionInr)
    return { tax: taxable * INDIA_EQUITY_TAX.ltcgRate, rate: INDIA_EQUITY_TAX.ltcgRate, kind: 'ltcg' }
  }
  return { tax: Math.max(0, gain) * INDIA_EQUITY_TAX.stcgRate, rate: INDIA_EQUITY_TAX.stcgRate, kind: 'stcg' }
}

function yearFrac(from: string, to: string): number {
  const a = Date.parse(from)
  const b = Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error('bad cashflow date')
  return (b - a) / (365 * 24 * 60 * 60 * 1000)
}

function npv(rate: number, flows: { amount: number; date: string }[], first: string): number {
  return flows.reduce((sum, flow) => sum + flow.amount / (1 + rate) ** yearFrac(first, flow.date), 0)
}

/** Newton on the NPV. Returns the annual rate, or null when it does not settle. */
export function xirr(flows: { amount: number; date: string }[], guess = 0.1): number | null {
  if (flows.length < 2) return null
  const dates = [...flows].sort((a, b) => a.date.localeCompare(b.date))
  const first = dates[0].date
  let rate = guess
  for (let i = 0; i < 50; i++) {
    const value = npv(rate, dates, first)
    const bump = Math.max(1e-6, Math.abs(rate) * 1e-4)
    const slope = (npv(rate + bump, dates, first) - value) / bump
    if (Math.abs(slope) < 1e-12) return null
    const next = rate - value / slope
    if (!Number.isFinite(next) || next <= -0.999) return null
    if (Math.abs(next - rate) < 1e-8) return next
    rate = next
  }
  return null
}

export interface NavRow {
  code: string
  name: string
  nav: number
  date: string
}

/** AMFI NAVAll.txt: code; isin payout; isin reinvest; name; nav; date. AMC banner lines are skipped. */
export function parseAmfiNav(text: string): NavRow[] {
  const rows: NavRow[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(';')
    if (parts.length < 6) continue
    const nav = Number(parts[4])
    if (!parts[0].trim() || !parts[3].trim() || !Number.isFinite(nav)) continue
    rows.push({ code: parts[0].trim(), name: parts[3].trim(), nav, date: parts[5].trim() })
  }
  return rows
}

export function findNav(rows: NavRow[], query: string): NavRow | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  return rows.find((row) => row.code.toLowerCase() === needle || row.name.toLowerCase().includes(needle)) ?? null
}

export function parseBhavCsv(text: string): { symbol: string; close: number; date: string }[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const header = lines[0].split(',').map((cell) => cell.trim().toLowerCase())
  const symbolAt = header.findIndex((cell) => cell === 'symbol' || cell === 'tckrsymb')
  const closeAt = header.findIndex((cell) => cell === 'close' || cell === 'clspric')
  const dateAt = header.findIndex((cell) => cell === 'date' || cell === 'timestamp' || cell === 'traddt')
  if (symbolAt < 0 || closeAt < 0) return []
  const rows: { symbol: string; close: number; date: string }[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    const close = Number(cells[closeAt])
    if (!cells[symbolAt] || !Number.isFinite(close)) continue
    rows.push({ symbol: cells[symbolAt].trim(), close, date: dateAt >= 0 ? cells[dateAt].trim() : '' })
  }
  return rows
}

export function nseBhavUrl(yyyymmdd: string): string {
  return `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyymmdd}_F_0000.csv.zip`
}

export function bseBhavUrl(ddmmyy: string): string {
  return `https://www.bseindia.com/download/BhavCopy/Equity/EQ${ddmmyy}_CSV.ZIP`
}

export interface RssItem {
  title: string
  url: string
  date: string | null
}

export function parseRss(xml: string): RssItem[] {
  const rows: RssItem[] = []
  for (const block of xml.split(/<item\b/i).slice(1)) {
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || ''
    const url = block.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1]?.trim() || ''
    const date = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() || null
    if (title && url.startsWith('http')) rows.push({ title, url, date })
  }
  return rows.slice(0, 8)
}

const COINS: Record<string, string> = {
  bitcoin: 'bitcoin', btc: 'bitcoin',
  ethereum: 'ethereum', eth: 'ethereum',
  solana: 'solana', sol: 'solana',
}

export function stockSymbol(question: string): string | null {
  const quoted = question.match(/["']([A-Za-z][A-Za-z0-9-]{1,15})["']/)
  if (quoted) return quoted[1]
  const named = question.match(/\b(?:of|for)\s+([A-Za-z][A-Za-z0-9-]{1,15})\b/)
  if (named && !/^(the|a|an|today|india|nse|bse)$/i.test(named[1])) return named[1]
  return null
}

export async function fetchOfficialEod(
  symbol: string,
  ctx: Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'>,
  fixtureCsv?: string,
): Promise<{ symbol: string; close: number; date: string; source: string; url: string } | null> {
  if (fixtureCsv) {
    const row = parseBhavCsv(fixtureCsv).find((item) => item.symbol.toLowerCase() === symbol.toLowerCase())
    return row ? { ...row, source: 'NSE bhavcopy', url: nseBhavUrl('00000000') } : null
  }
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const ymd = day.toISOString().slice(0, 10).replace(/-/g, '')
  const ddmmyy = `${ymd.slice(6, 8)}${ymd.slice(4, 6)}${ymd.slice(2, 4)}`
  const attempts = [
    { url: nseBhavUrl(ymd), source: 'NSE bhavcopy' },
    { url: bseBhavUrl(ddmmyy), source: 'BSE bhavcopy' },
  ]
  for (const attempt of attempts) {
    const res = await politeFetch(attempt.url, { ...ctx, timeoutMs: 8000, perMinute: 4 })
    if (!res) continue
    const bytes = Buffer.from(await res.arrayBuffer())
    let csv = ''
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      try {
        const zip = await JSZip.loadAsync(bytes)
        const file = Object.values(zip.files).find((entry) => !entry.dir && /\.csv$/i.test(entry.name))
        csv = file ? await file.async('string') : ''
      } catch {
        csv = ''
      }
    } else {
      csv = bytes.toString('utf8')
    }
    const row = parseBhavCsv(csv).find((item) => item.symbol.toLowerCase() === symbol.toLowerCase())
    if (row) return { ...row, source: attempt.source, url: attempt.url }
  }
  return null
}

export function eodAnswer(
  row: { symbol: string; close: number; date: string; source: string; url: string },
  region: RegionChoice,
): FinanceAnswer {
  const excerpt = `${row.symbol} close ${row.close} on ${row.date || 'the file date'}. Source: ${row.source}. End of day only.`
  return {
    text: [
      regionBanner(region.label),
      `${row.symbol} close ${row.close} on ${row.date || 'the file date'} [S1].`,
      excerpt,
      FINANCE_DISCLAIMER,
    ].join('\n'),
    citations: [cite(`${row.symbol} end of day`, row.url, excerpt, row.date || null, 'exchange')],
  }
}

export function feedAnswer(source: string, url: string, items: RssItem[], region: RegionChoice): FinanceAnswer {
  const top = items.slice(0, 3)
  const lines = top.map((item, index) => `[S${index + 1}] ${item.title}${item.date ? ` (${item.date})` : ''}`)
  return {
    text: [regionBanner(region.label), ...lines, `Source: ${source}.`, FINANCE_DISCLAIMER].join('\n'),
    citations: top.map((item) => cite(item.title, item.url || url, item.title, item.date, source)),
  }
}

export function coinId(question: string): string | null {
  for (const [name, id] of Object.entries(COINS)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(question)) return id
  }
  return null
}

export function parseSipQuestion(question: string): { monthly: number; annualRate: number; months: number } | null {
  if (!/\bsip\b/i.test(question)) return null
  const monthly = question.match(/(\d+(?:\.\d+)?)\s*(?:per month|a month|\/month|monthly)/i)
  const rate = question.match(/(\d+(?:\.\d+)?)\s*%/)
  const months = question.match(/(\d+)\s*months?/i)
  if (!monthly || !rate || !months) return null
  return { monthly: Number(monthly[1]), annualRate: Number(rate[1]) / 100, months: Number(months[1]) }
}

export function parsePnlQuestion(question: string): { qty: number; buy: number; sell: number } | null {
  if (!/\b(bought|sold|p&l|pnl|profit and loss)\b/i.test(question)) return null
  const qty = question.match(/(\d+(?:\.\d+)?)\s*shares?/i)
  const buy = question.match(/(?:bought|buy|at)\s+(\d+(?:\.\d+)?)/i)
  const sell = question.match(/(?:sold|sell)\s+(?:at\s+)?(\d+(?:\.\d+)?)/i)
  if (!qty || !buy || !sell) return null
  return { qty: Number(qty[1]), buy: Number(buy[1]), sell: Number(sell[1]) }
}

function money(value: number): string {
  return value.toFixed(2)
}

function cite(title: string, url: string, excerpt: string, published: string | null, pack: string): Citation {
  return { kind: url.startsWith('http') ? 'web' : 'document', title, url, pack, published, excerpt }
}

export interface FinanceAnswer {
  text: string
  citations: Citation[]
}

export function sipAnswer(input: { monthly: number; annualRate: number; months: number }, region: RegionChoice): FinanceAnswer {
  const value = sipFutureValue(input.monthly, input.annualRate, input.months)
  const shown = money(value)
  const excerpt = `End-of-month SIP future value. Monthly ${input.monthly}, annual rate ${input.annualRate}, months ${input.months}.`
  return {
    text: [
      regionBanner(region.label),
      `Future value ${shown} [S1].`,
      excerpt,
      'Source: in-app SIP formula, calculated on this computer. No market date; this is not a published price.',
      FINANCE_DISCLAIMER,
    ].join('\n'),
    citations: [cite('SIP future value', '', excerpt, null, 'finance-math')],
  }
}

export function pnlAnswer(input: { qty: number; buy: number; sell: number }, region: RegionChoice): FinanceAnswer {
  const result = profitLoss(input.qty, input.buy, input.sell)
  const excerpt = `${input.qty} shares, buy ${input.buy}, sell ${input.sell}.`
  return {
    text: [
      regionBanner(region.label),
      `Profit or loss ${money(result.pnl)} (${(result.pct * 100).toFixed(2)}%) [S1].`,
      excerpt,
      'Source: in-app P&L formula, calculated on this computer.',
      FINANCE_DISCLAIMER,
    ].join('\n'),
    citations: [cite('Profit and loss', '', excerpt, null, 'finance-math')],
  }
}

export function taxAnswer(gain: number, days: number, region: RegionChoice, india: boolean): FinanceAnswer {
  if (!india) {
    return {
      text: [
        regionBanner(region.label),
        'The bundled equity tax table is the India table dated 2024-07-23. It is not applied for this region [S1].',
        FINANCE_DISCLAIMER,
      ].join('\n'),
      citations: [cite('India equity tax table', '', INDIA_EQUITY_TAX.source, INDIA_EQUITY_TAX.asOf, 'finance-math')],
    }
  }
  const tax = indiaEquityTax(gain, days)
  const excerpt = `${tax.kind.toUpperCase()} at ${(tax.rate * 100).toFixed(1)}% on gain ${gain} held ${days} days. Table date ${INDIA_EQUITY_TAX.asOf}.`
  return {
    text: [
      regionBanner(region.label),
      `Tax ${money(tax.tax)} [S1].`,
      excerpt,
      `Source: ${INDIA_EQUITY_TAX.source}`,
      'This is not tax advice.',
      FINANCE_DISCLAIMER,
    ].join('\n'),
    citations: [cite('India equity tax table', '', excerpt, INDIA_EQUITY_TAX.asOf, 'finance-math')],
  }
}

type FetchCtx = Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'>

export async function fetchNav(query: string, ctx: FetchCtx, fixture?: string): Promise<FinanceAnswer | null> {
  const text = fixture ?? await (async () => {
    const res = await politeFetch(AMFI_NAV_URL, { ...ctx, timeoutMs: 8000, perMinute: 4, headers: { accept: 'text/plain' } })
    return res ? res.text() : null
  })()
  if (!text) return null
  const row = findNav(parseAmfiNav(text), query.replace(/\b(amfi|nav|of|the|fund)\b/gi, ' ').replace(/\s+/g, ' ').trim())
  if (!row) return null
  const excerpt = `${row.name} NAV ${row.nav} on ${row.date}.`
  return {
    text: '',
    citations: [cite(row.name, AMFI_NAV_URL, excerpt, row.date, 'amfi')],
  }
}

export function navAnswer(row: { name: string; nav: number; date: string }, region: RegionChoice): FinanceAnswer {
  const excerpt = `${row.name} NAV ${row.nav} on ${row.date}. File: ${AMFI_NAV_URL}.`
  return {
    text: [
      regionBanner(region.label),
      `NAV ${row.nav} on ${row.date} [S1].`,
      excerpt,
      FINANCE_DISCLAIMER,
    ].join('\n'),
    citations: [cite(row.name, AMFI_NAV_URL, excerpt, row.date, 'amfi')],
  }
}

export async function fetchCoin(id: string, ctx: FetchCtx): Promise<{ price: number; currency: string; at: string } | null> {
  const url = `${COINGECKO_PRICE}?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_last_updated_at=true`
  const res = await politeFetch(url, { ...ctx, perMinute: 10 })
  if (!res) return null
  const body = await res.json() as Record<string, { usd?: number; last_updated_at?: number }>
  const row = body[id]
  if (!row || typeof row.usd !== 'number') return null
  const at = row.last_updated_at ? new Date(row.last_updated_at * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
  return { price: row.usd, currency: 'usd', at }
}

export function coinAnswer(id: string, price: { price: number; currency: string; at: string }, region: RegionChoice): FinanceAnswer {
  const excerpt = `${id} ${price.price} ${price.currency} as of ${price.at}. Source: CoinGecko simple price.`
  return {
    text: [
      regionBanner(region.label),
      `${id} ${price.price} ${price.currency.toUpperCase()} as of ${price.at} [S1].`,
      excerpt,
      FINANCE_DISCLAIMER,
    ].join('\n'),
    citations: [cite(`${id} price`, `${COINGECKO_PRICE}?ids=${id}&vs_currencies=usd`, excerpt, price.at, 'coingecko')],
  }
}

export function unavailableFinance(region: RegionChoice, what: string): FinanceAnswer {
  return {
    text: [
      regionBanner(region.label),
      `${what} is not available from the official source right now [S1].`,
      'No number was filled in from the model.',
      FINANCE_DISCLAIMER,
    ].join('\n'),
    citations: [cite(what, '', 'Live source did not return a figure.', null, 'finance')],
  }
}
