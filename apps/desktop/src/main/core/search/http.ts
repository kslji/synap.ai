/**
 * Polite client for official public APIs. No API key is added.
 * A rate limit, timeout, or HTTP error returns null. Callers degrade to the next source.
 */
import { BlockList, isIP } from 'node:net'
import { assertNetworkAllowed } from '../offline-guard.js'
import { SEARCH_UA } from './types.js'

const V4 = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) V4.addSubnet(net, bits, 'ipv4')

const buckets = new Map<string, number[]>()

export function resetRateLimits(): void {
  buckets.clear()
}

export function publicHttpUrl(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.local') || host === 'metadata.google.internal') return false
  if (isIP(host) && (host.includes(':') ? false : V4.check(host))) return false
  return true
}

export interface PoliteOpts {
  offlineOnly: boolean
  fetchImpl?: typeof fetch
  timeoutMs?: number
  perMinute?: number
  signal?: AbortSignal
  headers?: Record<string, string>
  method?: string
  body?: string
}

/** One token per call, per host, inside a rolling minute. A spent bucket skips the call. */
export function takeToken(host: string, perMinute: number, now = Date.now()): boolean {
  const windowMs = 60_000
  const prev = (buckets.get(host) ?? []).filter((at) => now - at < windowMs)
  if (prev.length >= perMinute) {
    buckets.set(host, prev)
    return false
  }
  prev.push(now)
  buckets.set(host, prev)
  return true
}

export async function politeFetch(url: string, opts: PoliteOpts): Promise<Response | null> {
  assertNetworkAllowed(opts.offlineOnly)
  if (!publicHttpUrl(url)) return null
  let host = ''
  try { host = new URL(url).hostname } catch { return null }
  if (!takeToken(host, opts.perMinute ?? 20)) return null
  const headers = new Headers(opts.headers)
  if (!headers.has('user-agent')) headers.set('user-agent', SEARCH_UA)
  if (!headers.has('accept')) headers.set('accept', 'application/json, text/html;q=0.8, */*;q=0.5')
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body,
      signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 8000),
      redirect: 'follow',
    })
    if (res.status === 429 || res.status >= 500) return null
    if (!res.ok) return null
    return res
  } catch {
    return null
  }
}
