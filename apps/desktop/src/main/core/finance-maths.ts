/**
 * Local finance calculations. Nothing here reaches the network.
 *
 * The figures come from these formulas and from a file the user supplied.
 * The model is never asked for a number. Every answer names a date and a source.
 * This is not a recommendation to buy or sell.
 */

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

/** NAVAll.txt shape: code; isin payout; isin reinvest; name; nav; date. Banner lines are skipped. */
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

export function navQuery(question: string): string {
  return question
    .replace(/[?.,!;:]+/g, ' ')
    .replace(/\b(amfi|nav|what|is|of|the|a|an|please|show|me)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function findNav(rows: NavRow[], query: string): NavRow | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  return rows.find((row) => row.code.toLowerCase() === needle || row.name.toLowerCase().includes(needle)) ?? null
}

/** A bhav copy the user opened. Column names of NSE and BSE exports are both accepted. */
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

export function stockSymbol(question: string): string | null {
  const quoted = question.match(/["']([A-Za-z][A-Za-z0-9-]{1,15})["']/)
  if (quoted) return quoted[1]
  const named = question.match(/\b(?:of|for)\s+([A-Za-z][A-Za-z0-9-]{1,15})\b/)
  if (named && !/^(the|a|an|today|india|nse|bse)$/i.test(named[1])) return named[1]
  return null
}

const COINS: Record<string, string> = {
  bitcoin: 'bitcoin', btc: 'bitcoin',
  ethereum: 'ethereum', eth: 'ethereum',
  solana: 'solana', sol: 'solana',
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
