/**
 * Calls the search service from the main process.
 * assertNetworkAllowed runs before any request, including device registration.
 * Page text is not stored here. The service is responsible for SSRF checks.
 */
import { assertNetworkAllowed } from './offline-guard.js'
import { searchBody } from './web-decision.js'

export class WebClientError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'WebClientError'
  }
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  published: string | null
}

export interface FetchedChunk {
  url: string
  title: string
  published: string | null
  text: string
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface WebCall {
  base: string
  token?: string
  offlineOnly: boolean
  fetchImpl?: FetchLike
  signal?: AbortSignal
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`
}

async function call(path: string, opts: WebCall, init: RequestInit): Promise<Response> {
  assertNetworkAllowed(opts.offlineOnly)
  const headers = new Headers(init.headers)
  if (opts.token) headers.set('authorization', `Bearer ${opts.token}`)
  if (init.body) headers.set('content-type', 'application/json')
  const res = await (opts.fetchImpl ?? fetch)(endpoint(opts.base, path), { ...init, headers, signal: opts.signal })
  return res
}

export async function registerDevice(opts: WebCall): Promise<string> {
  const res = await call('/v1/devices/register', opts, { method: 'POST', body: '{}' })
  if (!res.ok) throw new WebClientError('device registration failed', res.status)
  const body = await res.json() as { token?: string }
  if (!body.token) throw new WebClientError('device registration failed', res.status)
  return body.token
}

export async function searchWeb(opts: WebCall & { query: string; k?: number }): Promise<SearchResult[]> {
  const res = await call('/v1/search', opts, { method: 'POST', body: JSON.stringify(searchBody(opts.query, opts.k ?? 5)) })
  if (!res.ok) throw new WebClientError('search failed', res.status)
  const body = await res.json() as { results?: Array<{ title?: string; url?: string; snippet?: string; published?: string | null }> }
  return (body.results ?? [])
    .filter((item) => typeof item.url === 'string' && item.url.startsWith('http'))
    .map((item) => ({
      title: item.title || item.url || '',
      url: item.url || '',
      snippet: item.snippet || '',
      published: item.published ?? null,
    }))
}

export async function fetchPages(opts: WebCall & { urls: string[] }): Promise<FetchedChunk[]> {
  if (!opts.urls.length) return []
  const res = await call('/v1/fetch', opts, { method: 'POST', body: JSON.stringify({ urls: opts.urls.slice(0, 5) }) })
  if (!res.ok) throw new WebClientError('fetch failed', res.status)
  const body = await res.json() as { chunks?: Array<{ url?: string; title?: string; published?: string | null; text?: string }> }
  return (body.chunks ?? [])
    .filter((item) => item.url && item.text)
    .map((item) => ({
      url: item.url || '',
      title: item.title || item.url || '',
      published: item.published ?? null,
      text: item.text || '',
    }))
}

export async function probeHealth(base: string, timeoutMs = 3000, fetchImpl?: FetchLike): Promise<boolean> {
  try {
    const res = await (fetchImpl ?? fetch)(endpoint(base, '/v1/health'), { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}
