/**
 * Public quote-page parsing. The displayed price text is kept as printed.
 * No JSON quote API and no yfinance.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

const ZONE_NAMES: Record<string, string> = {
  IST: 'Asia/Kolkata',
  UTC: 'UTC',
  GMT: 'UTC',
  EST: 'America/New_York',
  EDT: 'America/New_York',
  PST: 'America/Los_Angeles',
  PDT: 'America/Los_Angeles',
  BST: 'Europe/London',
}

export interface QuoteExtract {
  price: string
  asOf: string
}

export interface QuoteChip {
  label: string
  url: string
  index: number
}

export interface QuoteProvider {
  id: string
  name: string
  regions: string[]
  pageUrl: (symbol: string) => string
  parse: (html: string) => QuoteExtract | null
}

export function quoteChipLabel(site: string, index: number): string {
  return `${site} +${index}`
}

export function quoteChips(sources: { name: string; url: string }[]): QuoteChip[] {
  return sources.map((source, index) => ({
    label: quoteChipLabel(source.name, index + 1),
    url: source.url,
    index: index + 1,
  }))
}

export function formatQuoteAsOf(iso: string, timeZone: string): string {
  const at = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const tz = get('timeZoneName') || timeZone
  return `${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${tz}`
}

export function reportedPriceLine(iso: string, timeZone: string): string {
  return `Reported price as of ${formatQuoteAsOf(iso, timeZone)}`
}

export function quotePriceShown(answer: string, extracted: string): boolean {
  return extracted.length > 0 && answer.includes(extracted)
}

function tagBlocks(html: string, name: string): { attrs: string; text: string }[] {
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}>`, 'gi')
  return [...html.matchAll(re)].map((match) => ({
    attrs: match[1] ?? '',
    text: (match[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }))
}

function attr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return match?.[1] ?? null
}

function displayedPrice(value: string | null | undefined): string | null {
  const text = value?.trim() ?? ''
  if (!/^[0-9][0-9,]*(?:\.[0-9]+)?$/.test(text)) return null
  const numeric = Number(text.replace(/,/g, ''))
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  return text
}

function isoFromUnix(value: string | null): string | null {
  if (!value || !/^\d{9,}$/.test(value)) return null
  const at = Number(value) * 1000
  if (!Number.isFinite(at)) return null
  return new Date(at).toISOString()
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): string | null {
  const guess = Date.UTC(year, month, day, hour, minute)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((part) => [part.type, part.value]))
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  const at = guess - (asUtc - guess)
  if (!Number.isFinite(at)) return null
  return new Date(at).toISOString()
}

export function parseClockText(value: string): string | null {
  const match = value.match(/(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(IST|UTC|GMT|EST|EDT|PST|PDT|BST)?/i)
  if (!match) return null
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()]
  if (month == null) return null
  const zone = ZONE_NAMES[(match[6] || 'UTC').toUpperCase()]
  if (!zone) return null
  return zonedToUtc(Number(match[3]), month, Number(match[1]), Number(match[4]), Number(match[5]), zone)
}

function timeIn(html: string): string | null {
  for (const block of tagBlocks(html, 'time')) {
    const stamped = attr(block.attrs, 'datetime')
    if (stamped && !Number.isNaN(Date.parse(stamped))) return new Date(stamped).toISOString()
    const clock = parseClockText(block.text)
    if (clock) return clock
  }
  return null
}

export function parseYahooQuote(html: string): QuoteExtract | null {
  const priceTag = tagBlocks(html, 'fin-streamer').find((block) => attr(block.attrs, 'data-field') === 'regularMarketPrice')
  const testId = tagBlocks(html, 'span').find((block) => attr(block.attrs, 'data-testid') === 'qsp-price')
  const price = displayedPrice(priceTag?.text || testId?.text)
  if (!price) return null
  const timeTag = tagBlocks(html, 'fin-streamer').find((block) => attr(block.attrs, 'data-field') === 'regularMarketTime')
  const asOf = isoFromUnix(timeTag ? attr(timeTag.attrs, 'data-value') : null) ?? timeIn(html)
  if (!asOf) return null
  return { price, asOf }
}

export function parseEtQuote(html: string): QuoteExtract | null {
  const priceTag = tagBlocks(html, 'span').find((block) => /\bltp\b/i.test(attr(block.attrs, 'class') || ''))
  const price = displayedPrice(priceTag?.text)
  if (!price) return null
  const update = tagBlocks(html, 'span').find((block) => /\bupdateTime\b/i.test(attr(block.attrs, 'class') || ''))
  const asOf = timeIn(html) ?? (update ? parseClockText(update.text) : null)
  if (!asOf) return null
  return { price, asOf }
}

export function parseMoneycontrolQuote(html: string): QuoteExtract | null {
  const priceTag = [...html.matchAll(/<([a-z0-9]+)\b([^>]*\bid\s*=\s*"nsecp"[^>]*)>([\s\S]*?)<\/\1>/gi)][0]
  const price = displayedPrice(priceTag?.[3]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
  if (!price) return null
  const asOf = timeIn(html)
  if (!asOf) return null
  return { price, asOf }
}

export function bareSymbol(symbol: string): string {
  return symbol.replace(/\.(NS|BO|L)$/i, '')
}

export function providerSymbol(providerId: string, symbol: string, region: string): string {
  const bare = bareSymbol(symbol).toUpperCase()
  if (providerId === 'yahoo' && region.toUpperCase() === 'IN' && !symbol.includes('.')) return `${bare}.NS`
  if (providerId === 'yahoo') return symbol.includes('.') ? symbol.toUpperCase() : bare
  return bare
}

export const QUOTE_PROVIDERS: QuoteProvider[] = [
  {
    id: 'et',
    name: 'ET Markets',
    regions: ['IN'],
    pageUrl: (symbol) => `https://economictimes.indiatimes.com/markets/stocks/stock-quotes/${encodeURIComponent(symbol)}`,
    parse: parseEtQuote,
  },
  {
    id: 'moneycontrol',
    name: 'Moneycontrol',
    regions: ['IN'],
    pageUrl: (symbol) => `https://www.moneycontrol.com/india/stockpricequote/${encodeURIComponent(symbol)}`,
    parse: parseMoneycontrolQuote,
  },
  {
    id: 'yahoo',
    name: 'Yahoo Finance',
    regions: ['*'],
    pageUrl: (symbol) => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
    parse: parseYahooQuote,
  },
]

export function providersForRegion(region: string, providers: QuoteProvider[] = QUOTE_PROVIDERS): QuoteProvider[] {
  const code = region.toUpperCase()
  return providers.filter((provider) => provider.regions.includes('*') || provider.regions.includes(code))
}
