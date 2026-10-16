/**
 * DuckDuckGo lite HTML is a best-effort fallback. Failure returns an empty list.
 */
import { politeFetch, type PoliteOpts } from './http.js'
import type { ConnectorHit } from './types.js'

export function parseDdgLite(html: string): ConnectorHit[] {
  const rows: ConnectorHit[] = []
  const linkRe = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippets = [...html.matchAll(/<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi)].map((item) => item[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  let index = 0
  for (const match of html.matchAll(linkRe)) {
    const url = match[1].trim()
    const title = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!url.startsWith('http') || !title) continue
    rows.push({ source: 'DuckDuckGo', title: title.slice(0, 180), url, snippet: snippets[index] || '', published: null })
    index += 1
    if (rows.length >= 5) break
  }
  return rows
}

export async function searchDdg(query: string, opts: Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'>): Promise<ConnectorHit[]> {
  try {
    const body = `q=${encodeURIComponent(query)}`
    const res = await politeFetch('https://lite.duckduckgo.com/lite/', {
      ...opts,
      method: 'POST',
      body,
      perMinute: 6,
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
    })
    if (!res) return []
    const html = await res.text()
    return parseDdgLite(html)
  } catch {
    return []
  }
}
