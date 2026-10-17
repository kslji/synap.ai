/**
 * On-device DuckDuckGo lookup. The JSON instant-answer API is tried first.
 * Lite HTML is only a fallback: that page often returns an HTTP 202 challenge
 * with no result links, which is an empty list, not an error.
 */
import { politeFetch, type PoliteOpts } from './http.js'
import type { ConnectorHit } from './types.js'

function clean(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function parseDdgInstant(body: unknown): ConnectorHit[] {
  if (!body || typeof body !== 'object') return []
  const row = body as {
    Abstract?: string
    AbstractURL?: string
    AbstractSource?: string
    Heading?: string
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>
  }
  const rows: ConnectorHit[] = []
  const abstractUrl = row.AbstractURL || ''
  const abstract = clean(row.Abstract || '')
  if (abstract && abstractUrl.startsWith('http') && !abstractUrl.includes('duckduckgo.com/')) {
    rows.push({
      source: row.AbstractSource || 'DuckDuckGo',
      title: clean(row.Heading || row.AbstractSource || abstract).slice(0, 180),
      url: abstractUrl,
      snippet: abstract.slice(0, 500),
      published: null,
    })
  }
  const topics = row.RelatedTopics ?? []
  for (const topic of topics) {
    const nested = 'Topics' in topic && Array.isArray(topic.Topics) ? topic.Topics : [topic as { Text?: string; FirstURL?: string }]
    for (const item of nested) {
      const url = item.FirstURL || ''
      const text = clean(item.Text || '')
      if (!text || !url.startsWith('http') || url.includes('duckduckgo.com/')) continue
      rows.push({ source: 'DuckDuckGo', title: text.slice(0, 180), url, snippet: text.slice(0, 500), published: null })
      if (rows.length >= 5) return rows
    }
  }
  return rows.slice(0, 5)
}

export function parseDdgLite(html: string): ConnectorHit[] {
  const rows: ConnectorHit[] = []
  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippets = [...html.matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => clean(item[1]))
  let index = 0
  for (const match of html.matchAll(linkRe)) {
    const url = match[1].trim()
    const title = clean(match[2])
    if (!url.startsWith('http') || !title) continue
    rows.push({ source: 'DuckDuckGo', title: title.slice(0, 180), url, snippet: snippets[index] || '', published: null })
    index += 1
    if (rows.length >= 5) break
  }
  if (rows.length) return rows
  const loose = /<a[^>]*href="(https?:\/\/(?!lite\.duckduckgo\.com|duckduckgo\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  for (const match of html.matchAll(loose)) {
    const url = match[1].trim()
    const title = clean(match[2])
    if (!title || title.length < 2) continue
    rows.push({ source: 'DuckDuckGo', title: title.slice(0, 180), url, snippet: '', published: null })
    if (rows.length >= 5) break
  }
  return rows
}

async function searchDdgInstant(query: string, opts: Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'>): Promise<ConnectorHit[]> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  const res = await politeFetch(url, { ...opts, perMinute: 8, headers: { accept: 'application/json' } })
  if (!res) return []
  try {
    return parseDdgInstant(JSON.parse(await res.text()) as unknown)
  } catch {
    return []
  }
}

export async function searchDdg(query: string, opts: Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'>): Promise<ConnectorHit[]> {
  try {
    const instant = await searchDdgInstant(query, opts)
    if (instant.length) return instant
  } catch {
    /* lite HTML is the fallback */
  }
  try {
    const body = `q=${encodeURIComponent(query)}`
    const res = await politeFetch('https://lite.duckduckgo.com/lite/', {
      ...opts,
      method: 'POST',
      body,
      perMinute: 6,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
    })
    if (!res || res.status === 202) return []
    const html = await res.text()
    return parseDdgLite(html)
  } catch {
    return []
  }
}
