/**
 * Development-only web_search and fetch_page tools.
 *
 * They are absent unless NODE_ENV=development or SYNAP_DEV_WEB=1.
 * devWebTools() returns [] otherwise, so a production build never lists the names.
 *
 * The Code agent loop (draft PR #15, branch cursor/code-agent-loop-7dfa) is not
 * merged. Register these tools from that loop with codeAgentDevWebTools() in
 * ./code-agent/dev-web-hook.ts. Do not import the names into a production tool list.
 *
 * web_search calls the local FastAPI proxy (SYNAP_API_URL). fetch_page runs on
 * this computer: robots.txt, a timeout, a byte cap, and script stripping.
 * Page text is not logged. Every kept result includes its source URL.
 */
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { assertNetworkAllowed, OfflineOnlyError } from './offline-guard.js'
import { visibleHtml } from './html-sanitize.js'
import { searchWeb, WebClientError, type SearchResult } from './web-client.js'

export const DEV_API_PORT = 8000
export const DEV_API_URL = `http://127.0.0.1:${DEV_API_PORT}`
export const FETCH_TIMEOUT_MS = 8_000
export const FETCH_MAX_BYTES = 1_000_000
export const FETCH_TEXT_CAP = 8_000
const ROBOT_AGENT = 'SynapSurf'
const USER_AGENT = 'SynapSurf/0.1 (+https://synap.surf)'

export type EnvLike = Record<string, string | undefined>

export interface DevWebHost {
  apiBase: string
  offlineOnly: boolean
  fetchImpl?: FetchLike
  resolveHost?: (host: string) => Promise<string[]>
  timeoutMs?: number
  maxBytes?: number
  signal?: AbortSignal
  env?: EnvLike
}

export interface DevWebTool {
  name: 'web_search' | 'fetch_page'
  schema: unknown
  run(args: Record<string, unknown>): Promise<string>
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const V4 = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) V4.addSubnet(net, bits, 'ipv4')

const V6 = new BlockList()
V6.addAddress('::1', 'ipv6')
V6.addAddress('::', 'ipv6')
V6.addSubnet('fc00::', 7, 'ipv6')
V6.addSubnet('fe80::', 10, 'ipv6')
V6.addSubnet('ff00::', 8, 'ipv6')

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata.google'])

export class PublicUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PublicUrlError'
  }
}

export function devWebEnabled(env: EnvLike = process.env): boolean {
  return env['NODE_ENV'] === 'development' || env['SYNAP_DEV_WEB'] === '1'
}

function cleanUrl(value: string): string {
  return value.trim().replace(/\/$/, '')
}

function httpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const cleaned = cleanUrl(value)
  return /^https?:\/\/\S+$/.test(cleaned) ? cleaned : undefined
}

/**
 * Packaged builds ignore the localhost default. SYNAP_API_URL is used only when
 * it is set. Development (unpackaged, dev web on, no SURF_API_BASE) uses
 * http://127.0.0.1:8000.
 */
export function resolveSynapApiUrl(input: { packaged: boolean; settingsUrl: string; env?: EnvLike }): string {
  const env = input.env ?? process.env
  const explicit = httpUrl(env['SYNAP_API_URL'])
  const legacy = httpUrl(env['SURF_API_BASE'] || env['HARBOR_API_BASE'])
  const settings = cleanUrl(input.settingsUrl)
  if (input.packaged) return explicit || legacy || settings
  if (explicit) return explicit
  if (legacy) return legacy
  if (devWebEnabled(env)) return DEV_API_URL
  return settings
}

export function parseDevWebCommand(text: string): { tool: 'web_search'; query: string } | { tool: 'fetch_page'; url: string } | null {
  const trimmed = text.trim()
  const web = /^\/web\s+(\S[\s\S]*)$/i.exec(trimmed)
  if (web) {
    const query = web[1].trim()
    return query ? { tool: 'web_search', query } : null
  }
  const page = /^\/fetch\s+(\S+)$/i.exec(trimmed)
  if (page) return { tool: 'fetch_page', url: page[1].trim() }
  return null
}

interface RobotRule { allow: boolean; path: string }
interface RobotGroup { agents: string[]; rules: RobotRule[] }

function parseRobots(body: string): RobotGroup[] {
  const groups: RobotGroup[] = []
  let group: RobotGroup = { agents: [], rules: [] }
  const flush = () => {
    if (group.agents.length || group.rules.length) groups.push(group)
    group = { agents: [], rules: [] }
  }
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split('#')[0]?.trim() ?? ''
    if (!line) { flush(); continue }
    const split = line.indexOf(':')
    if (split < 0) continue
    const key = line.slice(0, split).trim().toLowerCase()
    const value = line.slice(split + 1).trim()
    if (key === 'user-agent') {
      if (group.rules.length) flush()
      group.agents.push(value.toLowerCase())
    } else if (key === 'allow' || key === 'disallow') {
      const allow = key === 'allow' || value === ''
      group.rules.push({ allow, path: value === '' ? '*' : (value.startsWith('/') ? value : `/${value}`) })
    }
  }
  flush()
  return groups
}

/** First matching Allow/Disallow wins, same as Python's robotparser. No matching group allows the URL. */
export function robotsAllows(body: string, url: string, agent = ROBOT_AGENT): boolean {
  let target = '/'
  try { target = decodeURIComponent(new URL(url).pathname || '/') } catch { target = new URL(url).pathname || '/' }
  const name = agent.toLowerCase()
  let best: RobotGroup | null = null
  let bestLen = -1
  let star: RobotGroup | null = null
  for (const group of parseRobots(body)) {
    if (!star && group.agents.includes('*')) star = group
    for (const ua of group.agents) {
      if (ua !== '*' && name.startsWith(ua) && ua.length > bestLen) {
        best = group
        bestLen = ua.length
      }
    }
  }
  const chosen = best ?? star
  if (!chosen) return true
  for (const rule of chosen.rules) {
    if (rule.path === '*' || target.startsWith(rule.path)) return rule.allow
  }
  return true
}

/** Drop script and style elements, including an unclosed tag through the end of the document. */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*$/gi, '')
}

function ipBlocked(address: string): boolean {
  const mapped = address.toLowerCase().startsWith('::ffff:') ? address.slice(7) : address
  if (isIP(mapped) === 4) return V4.check(mapped, 'ipv4')
  if (isIP(address) === 6) return V6.check(address, 'ipv6') || address.toLowerCase().startsWith('::ffff:')
  return true
}

function hostBlocked(host: string): boolean {
  const name = host.trim().toLowerCase().replace(/\.$/, '')
  if (!name || BLOCKED_HOSTS.has(name) || name.endsWith('.local') || name.endsWith('.internal') || name.endsWith('.localhost')) return true
  if (/^\d+$/.test(name)) return true
  if (isIP(name)) return ipBlocked(name)
  return false
}

async function defaultResolve(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true })
  return rows.map((row) => row.address)
}

export async function assertPublicUrl(url: string, resolveHost: (host: string) => Promise<string[]> = defaultResolve): Promise<string> {
  let parts: URL
  try { parts = new URL(url.trim()) } catch { throw new PublicUrlError('That address is not a public http(s) URL.') }
  if (parts.protocol !== 'http:' && parts.protocol !== 'https:') throw new PublicUrlError('Only http and https pages can be fetched.')
  if (parts.username || parts.password) throw new PublicUrlError('That address is not allowed.')
  const host = parts.hostname
  if (hostBlocked(host)) throw new PublicUrlError('That address is not a public page.')
  if (parts.port && parts.port !== '80' && parts.port !== '443') throw new PublicUrlError('That address is not allowed.')
  if (isIP(host)) return parts.toString()
  let addresses: string[]
  try { addresses = await resolveHost(host) } catch { throw new PublicUrlError('That address is not a public page.') }
  if (!addresses.length || addresses.some((address) => ipBlocked(address))) throw new PublicUrlError('That address is not a public page.')
  return parts.toString()
}

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required },
    },
  }
}

const SEARCH_SCHEMA = fn(
  'web_search',
  'Search the web. Each result includes its source URL. Development only.',
  { query: { type: 'string' }, k: { type: 'integer' } },
  ['query'],
)

const PAGE_SCHEMA = fn(
  'fetch_page',
  'Fetch one public page and return its text and source URL. Scripts are removed. Development only.',
  { url: { type: 'string' } },
  ['url'],
)

function formatSearch(rows: SearchResult[]): string {
  if (!rows.length) return 'No results.'
  return rows.map((row, index) => {
    const lines = [`[${index + 1}] ${row.title || row.url}`, `URL: ${row.url}`]
    if (row.snippet.trim()) lines.push(row.snippet.trim())
    return lines.join('\n')
  }).join('\n\n')
}

function timed(host: DevWebHost): { signal: AbortSignal; cancel(): void } {
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
  }, host.timeoutMs ?? FETCH_TIMEOUT_MS)
  const onParent = () => controller.abort(host.signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'))
  if (host.signal) {
    if (host.signal.aborted) controller.abort(host.signal.reason)
    else host.signal.addEventListener('abort', onParent, { once: true })
  }
  return {
    signal: controller.signal,
    cancel() {
      clearTimeout(timer)
      host.signal?.removeEventListener('abort', onParent)
    },
  }
}

function rethrowAbort(host: DevWebHost): void {
  if (host.signal?.aborted) throw host.signal.reason instanceof Error ? host.signal.reason : new Error('aborted')
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') || '')
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('size')
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    if (text.length > maxBytes) throw new Error('size')
    return text
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    total += step.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('size')
    }
    chunks.push(step.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

async function getPublic(url: string, host: DevWebHost, accept: string): Promise<{ url: string; status: number; body: string; contentType: string }> {
  const resolveHost = host.resolveHost ?? defaultResolve
  let current = await assertPublicUrl(url, resolveHost)
  const clock = timed(host)
  const fetchImpl = host.fetchImpl ?? fetch
  try {
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept },
        signal: clock.signal,
      })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) throw new PublicUrlError('That redirect is not allowed.')
        current = await assertPublicUrl(new URL(location, current).toString(), resolveHost)
        continue
      }
      const body = res.status === 200 ? await readCapped(res, host.maxBytes ?? FETCH_MAX_BYTES) : ''
      return { url: current, status: res.status, body, contentType: (res.headers.get('content-type') || '').toLowerCase() }
    }
    throw new PublicUrlError('Too many redirects.')
  } finally {
    clock.cancel()
  }
}

function robotsUrl(url: string): string {
  const parts = new URL(url)
  return `${parts.protocol}//${parts.host}/robots.txt`
}

async function pageAllowed(url: string, host: DevWebHost): Promise<{ ok: boolean; message?: string }> {
  try {
    const robots = await getPublic(robotsUrl(url), host, 'text/plain')
    if (robots.status === 200 && !robotsAllows(robots.body, url)) {
      return { ok: false, message: `error: robots.txt does not allow ${url}` }
    }
  } catch (error) {
    rethrowAbort(host)
    if (error instanceof Error && error.message === 'size') return { ok: false, message: `error: robots.txt is too large for ${url}` }
    if (error instanceof PublicUrlError) return { ok: true }
  }
  return { ok: true }
}

function searchTool(host: DevWebHost): DevWebTool {
  return {
    name: 'web_search',
    schema: SEARCH_SCHEMA,
    async run(args) {
      const query = String(args['query'] ?? '').trim().slice(0, 300)
      if (!query) return 'error: query is empty'
      const k = Math.min(8, Math.max(1, Math.round(Number(args['k'] ?? 5)) || 5))
      try {
        assertNetworkAllowed(host.offlineOnly)
        const clock = timed(host)
        try {
          const rows = await searchWeb({
            base: host.apiBase,
            offlineOnly: host.offlineOnly,
            fetchImpl: host.fetchImpl,
            query,
            k,
            signal: clock.signal,
          })
          return formatSearch(rows)
        } finally {
          clock.cancel()
        }
      } catch (error) {
        rethrowAbort(host)
        if (error instanceof OfflineOnlyError) return `error: ${error.message}`
        if (error instanceof WebClientError) return `error: search failed (${error.status})`
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return 'error: search timed out'
        return 'error: search failed'
      }
    },
  }
}

function pageTool(host: DevWebHost): DevWebTool {
  return {
    name: 'fetch_page',
    schema: PAGE_SCHEMA,
    async run(args) {
      const raw = String(args['url'] ?? '').trim()
      if (!raw) return 'error: url is empty'
      try {
        assertNetworkAllowed(host.offlineOnly)
        const url = await assertPublicUrl(raw, host.resolveHost ?? defaultResolve)
        const allowed = await pageAllowed(url, host)
        if (!allowed.ok) return allowed.message || `error: robots.txt does not allow ${url}`
        const page = await getPublic(url, host, 'text/html, text/plain')
        if (page.status !== 200) return `error: fetch failed (${page.status}) for ${url}`
        if (page.contentType && !page.contentType.includes('html') && !page.contentType.includes('text/plain')) {
          return `error: not an html page (${page.contentType.split(';')[0]}) for ${url}`
        }
        const visible = visibleHtml(stripScripts(page.body))
        let text = visible.text.trim()
        if (text.length > FETCH_TEXT_CAP) text = `${text.slice(0, FETCH_TEXT_CAP)}\n…`
        const title = visible.title?.trim()
        return [`URL: ${page.url}`, title ? `Title: ${title}` : '', text || '(no text)'].filter((line) => line !== '').join('\n')
      } catch (error) {
        rethrowAbort(host)
        if (error instanceof OfflineOnlyError) return `error: ${error.message}`
        if (error instanceof PublicUrlError) return `error: ${error.message} ${raw}`
        if (error instanceof Error && error.message === 'size') return `error: page is too large ${raw}`
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return `error: fetch timed out ${raw}`
        return `error: could not fetch ${raw}`
      }
    },
  }
}

/** Empty unless dev web is on. Production builds must keep this list empty. */
export function devWebTools(host: DevWebHost): DevWebTool[] {
  if (!devWebEnabled(host.env)) return []
  return [searchTool(host), pageTool(host)]
}

export function devWebToolSchemas(env?: EnvLike): readonly unknown[] {
  return devWebTools({ apiBase: DEV_API_URL, offlineOnly: false, env }).map((tool) => tool.schema)
}
