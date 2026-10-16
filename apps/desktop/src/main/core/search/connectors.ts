/**
 * Official public APIs. No key is sent. A bad response is an empty list.
 */
import { politeFetch, type PoliteOpts } from './http.js'
import type { ConnectorHit, Intent } from './types.js'

type FetchCtx = Pick<PoliteOpts, 'offlineOnly' | 'fetchImpl' | 'signal'>

async function textOf(res: Response | null): Promise<string | null> {
  if (!res) return null
  try { return await res.text() } catch { return null }
}

async function jsonOf(res: Response | null): Promise<unknown> {
  const text = await textOf(res)
  if (!text) return null
  try { return JSON.parse(text) as unknown } catch { return null }
}

function hit(source: string, title: string, url: string, snippet: string, published: string | null = null): ConnectorHit | null {
  if (!title || !url.startsWith('http')) return null
  return { source, title: title.slice(0, 180), url, snippet: snippet.slice(0, 500), published }
}

export async function searchGitHub(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=5`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 8, headers: { accept: 'application/vnd.github+json' } })) as { items?: { full_name?: string; html_url?: string; description?: string }[] } | null
  return (body?.items ?? []).map((item) => hit('GitHub', item.full_name || '', item.html_url || '', item.description || '')).filter((item): item is ConnectorHit => Boolean(item))
}

export async function searchStackExchange(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&pagesize=5&q=${encodeURIComponent(query)}`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 6 })) as { items?: { title?: string; link?: string; excerpt?: string }[] } | null
  return (body?.items ?? []).map((item) => hit('Stack Exchange', item.title || '', item.link || '', item.excerpt || '')).filter((item): item is ConnectorHit => Boolean(item))
}

export async function searchNpm(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=5`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 20 })) as { objects?: { package?: { name?: string; description?: string; links?: { npm?: string } } }[] } | null
  return (body?.objects ?? []).map((item) => hit('npm', item.package?.name || '', item.package?.links?.npm || '', item.package?.description || '')).filter((item): item is ConnectorHit => Boolean(item))
}

export async function searchPypi(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const name = query.trim()
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name) || name.includes(' ')) return []
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 20 })) as { info?: { name?: string; summary?: string; package_url?: string; version?: string } } | null
  const info = body?.info
  if (!info?.name) return []
  const row = hit('PyPI', info.name, info.package_url || `https://pypi.org/project/${info.name}/`, info.summary || '', info.version || null)
  return row ? [row] : []
}

export async function searchCrates(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://crates.io/api/v1/crates?q=${encodeURIComponent(query)}&per_page=5`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 10 })) as { crates?: { name?: string; description?: string; updated_at?: string }[] } | null
  return (body?.crates ?? []).map((item) => hit('crates.io', item.name || '', item.name ? `https://crates.io/crates/${item.name}` : '', item.description || '', item.updated_at || null)).filter((item): item is ConnectorHit => Boolean(item))
}

export async function searchWikipedia(query: string, ctx: FetchCtx, lang = 'en'): Promise<ConnectorHit[]> {
  const host = `${lang || 'en'}.wikipedia.org`
  const url = `https://${host}/w/api.php?action=query&list=search&utf8=1&format=json&srlimit=5&srsearch=${encodeURIComponent(query)}`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 20 })) as { query?: { search?: { title?: string; snippet?: string; timestamp?: string }[] } } | null
  return (body?.query?.search ?? []).map((item) => {
    const title = item.title || ''
    return hit('Wikipedia', title, title ? `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : '', (item.snippet || '').replace(/<[^>]+>/g, ''), item.timestamp || null)
  }).filter((item): item is ConnectorHit => Boolean(item))
}

export async function searchArxiv(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=5`
  const xml = await textOf(await politeFetch(url, { ...ctx, perMinute: 8, headers: { accept: 'application/atom+xml' } }))
  if (!xml) return []
  const rows: ConnectorHit[] = []
  for (const block of xml.split('<entry>').slice(1)) {
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, ' ').trim() || ''
    const id = block.match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim() || ''
    const summary = block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() || ''
    const published = block.match(/<published>([\s\S]*?)<\/published>/)?.[1]?.trim() || null
    const row = hit('arXiv', title, id, summary, published)
    if (row) rows.push(row)
  }
  return rows
}

export async function searchHuggingFace(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&limit=5`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 20 })) as { id?: string; pipeline_tag?: string; lastModified?: string }[] | null
  return (Array.isArray(body) ? body : []).map((item) => hit('Hugging Face', item.id || '', item.id ? `https://huggingface.co/${item.id}` : '', item.pipeline_tag || '', item.lastModified || null)).filter((item): item is ConnectorHit => Boolean(item))
}

export async function searchSemanticScholar(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=5&fields=title,url,abstract,year`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 8 })) as { data?: { title?: string; url?: string; abstract?: string; year?: number }[] } | null
  return (body?.data ?? []).map((item) => hit('Semantic Scholar', item.title || '', item.url || '', item.abstract || '', item.year ? String(item.year) : null)).filter((item): item is ConnectorHit => Boolean(item))
}

export async function searchHn(query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`
  const body = await jsonOf(await politeFetch(url, { ...ctx, perMinute: 20 })) as { hits?: { title?: string; url?: string; story_text?: string; created_at?: string; objectID?: string }[] } | null
  return (body?.hits ?? []).map((item) => {
    const page = item.url || (item.objectID ? `https://news.ycombinator.com/item?id=${item.objectID}` : '')
    return hit('Hacker News', item.title || '', page, item.story_text || '', item.created_at || null)
  }).filter((item): item is ConnectorHit => Boolean(item))
}

export const CONNECTORS = {
  github: searchGitHub,
  stackexchange: searchStackExchange,
  npm: searchNpm,
  pypi: searchPypi,
  crates: searchCrates,
  wikipedia: searchWikipedia,
  arxiv: searchArxiv,
  huggingface: searchHuggingFace,
  semanticscholar: searchSemanticScholar,
  hn: searchHn,
} as const

export type ConnectorId = keyof typeof CONNECTORS

const BY_INTENT: Record<Intent, ConnectorId[]> = {
  code: ['github', 'stackexchange', 'npm', 'pypi', 'crates', 'hn'],
  paper: ['arxiv', 'semanticscholar', 'huggingface', 'wikipedia'],
  news: ['hn', 'wikipedia'],
  general: ['wikipedia', 'hn'],
  finance: [],
  legal: [],
}

export function connectorsFor(intent: Intent): ConnectorId[] {
  return BY_INTENT[intent]
}

export async function runConnectors(intent: Intent, query: string, ctx: FetchCtx): Promise<ConnectorHit[]> {
  const rows: ConnectorHit[] = []
  for (const id of connectorsFor(intent)) {
    try {
      const found = await CONNECTORS[id](query, ctx)
      rows.push(...found)
    } catch {
      /* one source failing leaves the others */
    }
    if (rows.length >= 6) break
  }
  return rows.slice(0, 6)
}
