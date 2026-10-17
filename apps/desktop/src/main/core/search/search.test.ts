import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openUserDb } from '../db.js'
import { LIBRARY_MIGRATION } from '../library-schema.js'
import { SESSION_MIGRATION } from '../session-store.js'
import { WEB_CACHE_MIGRATION } from '../web-cache.js'
import { blockedHost } from './blocked.js'
import { SEARCH_CACHE_MIGRATION, SEARCH_TTL_MS, PAGE_TTL_MS, clearSearchCache, readCache, searchCacheStats, writeCache } from './cache.js'
import { citationProblems, ensureCitationMarkers, packVersionLine } from './citations.js'
import { CONNECTORS, connectorsFor, searchGitHub, searchStackExchange, searchNpm, searchPypi, searchCrates, searchWikipedia, searchArxiv, searchHuggingFace, searchSemanticScholar, searchHn } from './connectors.js'
import { parseDdgLite, searchDdg } from './ddg.js'
import {
  FINANCE_DISCLAIMER,
  cagr,
  indiaEquityTax,
  parseAmfiNav,
  parseBhavCsv,
  parseRss,
  profitLoss,
  simpleReturn,
  sipFutureValue,
  xirr,
} from './finance.js'
import { resetRateLimits, takeToken } from './http.js'
import { LEGAL_DISCLAIMER, legalAnswer, parseIndiaCode, providersFor, quoteFromHits, type LegalProvider } from './legal.js'
import { searchFixtureEnabled } from './mode.js'
import { pageToMarkdown, readPage, stripTrackers } from './reader.js'
import { labelForCode, lookupCountry, parseCountryTable, resolveRegion } from './region.js'
import { composeRouted, gatherOnline } from './run.js'
import { UNABLE_NEWS } from './verify-answer.js'
import { historyHits, pickLocal, planRoute } from './router.js'
import { LOCAL_LAYER_ORDER, type LocalHit } from './types.js'

const KEY = 'ab'.repeat(32)
const GEO = `
# sample ranges for tests, not a default country
134744064 134744319 US
203.0.113.0/24 AU
`

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'surf-search-cache-'))
  const handle = openUserDb(join(dir, 'user.db'), KEY, [SESSION_MIGRATION, LIBRARY_MIGRATION, WEB_CACHE_MIGRATION, SEARCH_CACHE_MIGRATION])
  return { dir, handle }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function hit(layer: LocalHit['layer'], text: string, score = 1): LocalHit {
  return { layer, title: layer, text, url: '', pack: layer, score }
}

test('local layers stay in pack, history, project, cache, files order', () => {
  assert.deepEqual([...LOCAL_LAYER_ORDER], ['pack', 'history', 'project', 'cache', 'files'])
  const picked = pickLocal([
    hit('files', 'on disk', 9),
    hit('pack', 'from the pack', 0.2),
    hit('cache', 'saved page', 5),
  ])
  assert.equal(picked?.layer, 'pack')
  assert.equal(pickLocal([hit('files', 'only a file')])?.layer, 'files')
  assert.equal(pickLocal([]), null)
})

test('online runs only after local sources are thin or the question is fresh', () => {
  const base = { question: 'When does the ferry leave?', hits: [hit('pack', '06:40', 0.9)], fresh: false, online: true, webAllowed: true, offlineOnly: false, legalQuoted: false }
  assert.equal(planRoute(base).online, false)
  assert.equal(planRoute({ ...base, fresh: true }).online, true)
  assert.equal(planRoute({ ...base, hits: [], fresh: false }).online, true)
  assert.equal(planRoute({ ...base, hits: [], offlineOnly: true }).online, false)
  assert.equal(planRoute({ ...base, question: 'bitcoin price', hits: [hit('pack', 'old note')] }).online, true)
  assert.equal(planRoute({ ...base, question: 'What does section 4 say?', legalQuoted: true, hits: [hit('files', 'Section 4. GL-2201')] }).online, false)
  const history = historyHits([{ role: 'assistant', text: 'The harbor ferry leaves at 06:40.' }], 'When does the harbor ferry leave?')
  assert.equal(history[0]?.layer, 'history')
  assert.equal(pickLocal(history)?.layer, 'history')
})

test('connectors are selected by intent and each one reads a mocked response', async () => {
  resetRateLimits()
  assert.deepEqual(connectorsFor('code'), ['github', 'stackexchange', 'npm', 'pypi', 'crates', 'hn'])
  assert.deepEqual(connectorsFor('paper'), ['arxiv', 'semanticscholar', 'huggingface', 'wikipedia'])
  assert.equal(connectorsFor('finance').length, 0)
  assert.equal(Object.keys(CONNECTORS).includes('reddit' as never), false)
  const ctx = { offlineOnly: false }
  const github = await searchGitHub('synap', { ...ctx, fetchImpl: async (url) => {
    assert.match(String(url), /api\.github\.com/)
    return jsonResponse({ items: [{ full_name: 'kslji/synap', html_url: 'https://github.com/kslji/synap', description: 'local' }] })
  } })
  assert.equal(github[0]?.source, 'GitHub')
  const stack = await searchStackExchange('sqlite', { ...ctx, fetchImpl: async () => jsonResponse({ items: [{ title: 'vec', link: 'https://stackoverflow.com/q/1', excerpt: 'use vec0' }] }) })
  assert.equal(stack[0]?.url, 'https://stackoverflow.com/q/1')
  const npm = await searchNpm('zod', { ...ctx, fetchImpl: async () => jsonResponse({ objects: [{ package: { name: 'zod', description: 'schemas', links: { npm: 'https://www.npmjs.com/package/zod' } } }] }) })
  assert.equal(npm[0]?.source, 'npm')
  const pypi = await searchPypi('httpx', { ...ctx, fetchImpl: async (url) => {
    assert.match(String(url), /pypi\.org\/pypi\/httpx/)
    return jsonResponse({ info: { name: 'httpx', summary: 'client', package_url: 'https://pypi.org/project/httpx/', version: '0.28.1' } })
  } })
  assert.equal(pypi[0]?.published, '0.28.1')
  assert.deepEqual(await searchPypi('not a package name', { ...ctx, fetchImpl: async () => { throw new Error('should not fetch') } }), [])
  const crates = await searchCrates('serde', { ...ctx, fetchImpl: async () => jsonResponse({ crates: [{ name: 'serde', description: 'ser', updated_at: '2026-01-01' }] }) })
  assert.match(crates[0]?.url || '', /crates\.io/)
  const wiki = await searchWikipedia('harbor', { ...ctx, fetchImpl: async () => jsonResponse({ query: { search: [{ title: 'Harbor', snippet: 'A <span>port</span>', timestamp: '2026-01-01' }] } }) })
  assert.equal(wiki[0]?.snippet, 'A port')
  const arxiv = await searchArxiv('embedding', { ...ctx, fetchImpl: async () => new Response('<feed><entry><title>Gemma</title><id>https://arxiv.org/abs/1</id><summary>vectors</summary><published>2026-01-01</published></entry></feed>') })
  assert.equal(arxiv[0]?.source, 'arXiv')
  const hf = await searchHuggingFace('gemma', { ...ctx, fetchImpl: async () => jsonResponse([{ id: 'google/gemma', pipeline_tag: 'feature-extraction', lastModified: '2026-01-01' }]) })
  assert.match(hf[0]?.url || '', /huggingface\.co/)
  const scholar = await searchSemanticScholar('gemma', { ...ctx, fetchImpl: async () => jsonResponse({ data: [{ title: 'Gemma', url: 'https://www.semanticscholar.org/paper/1', abstract: 'embed', year: 2026 }] }) })
  assert.equal(scholar[0]?.published, '2026')
  const hn = await searchHn('llama', { ...ctx, fetchImpl: async () => jsonResponse({ hits: [{ title: 'llama.cpp', url: 'https://news.ycombinator.com/item?id=1', created_at: '2026-01-01', objectID: '1' }] }) })
  assert.equal(hn[0]?.source, 'Hacker News')
})

test('a connector HTTP failure degrades and DuckDuckGo failure does not throw', async () => {
  resetRateLimits()
  const failed = await searchGitHub('synap', { offlineOnly: false, fetchImpl: async () => new Response('no', { status: 503 }) })
  assert.deepEqual(failed, [])
  assert.deepEqual(parseDdgLite('<a class="result-link" href="https://reddit.com/r/a">Skip</a><td class="result-snippet">x</td>'), [{ source: 'DuckDuckGo', title: 'Skip', url: 'https://reddit.com/r/a', snippet: 'x', published: null }])
  assert.equal(blockedHost('https://reddit.com/r/a'), true)
  assert.equal(blockedHost('https://x.com/someone'), true)
  const ddg = await searchDdg('ferry', { offlineOnly: false, fetchImpl: async () => { throw new Error('down') } })
  assert.deepEqual(ddg, [])
  const ok = parseDdgLite('<a class="result-link" href="https://example.com/a">Example</a><td class="result-snippet">A snippet</td>')
  assert.equal(ok[0]?.title, 'Example')
})

test('search cache expires searches in 24 hours and pages in 7 days', () => {
  const { dir, handle } = db()
  try {
    const now = Date.now()
    writeCache(handle, 'search', 'GLOBAL', 'ferry', '{"q":1}', now)
    writeCache(handle, 'page', 'GLOBAL', 'https://example.com/a', 'page text', now)
    assert.equal(readCache(handle, 'search', 'GLOBAL', 'ferry', now + SEARCH_TTL_MS - 1000), '{"q":1}')
    assert.equal(readCache(handle, 'search', 'GLOBAL', 'ferry', now + SEARCH_TTL_MS + 1000), null)
    assert.equal(readCache(handle, 'page', 'GLOBAL', 'https://example.com/a', now + PAGE_TTL_MS - 1000), 'page text')
    assert.equal(readCache(handle, 'page', 'GLOBAL', 'https://example.com/a', now + PAGE_TTL_MS + 1000), null)
    writeCache(handle, 'page', 'GLOBAL', 'https://example.com/b', 'x'.repeat(1000), now)
    const stats = searchCacheStats(handle)
    assert.ok(stats.count >= 1)
    assert.equal(stats.capBytes, 32 * 1024 * 1024)
    clearSearchCache(handle)
    assert.equal(searchCacheStats(handle).count, 0)
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('region uses the question, then the setting, then the IP table, then worldwide', async () => {
  const ranges = parseCountryTable(GEO)
  assert.equal(lookupCountry('8.8.8.8', ranges), 'US')
  assert.equal(lookupCountry('203.0.113.9', ranges), 'AU')
  assert.equal(lookupCountry('1.2.3.4', ranges), null)
  assert.equal(labelForCode('GLOBAL'), 'worldwide sources')
  const named = await resolveRegion({ question: 'NAV in Japan', myRegion: 'US', offlineOnly: false, geoText: GEO, fetchImpl: async () => new Response('8.8.8.8') })
  assert.equal(named.code, 'JP')
  assert.equal(named.source, 'question')
  const vpn = await resolveRegion({ question: 'latest ferry notice', myRegion: 'JP', offlineOnly: false, geoText: GEO, fetchImpl: async () => new Response('8.8.8.8') })
  assert.equal(vpn.source, 'setting')
  assert.equal(vpn.code, 'JP')
  let fetched = 0
  const ip = await resolveRegion({
    question: 'latest ferry notice',
    myRegion: '',
    offlineOnly: false,
    geoText: GEO,
    fetchImpl: async () => { fetched += 1; return new Response('8.8.8.8') },
  })
  assert.deepEqual(ip, { code: 'US', label: 'the United States', source: 'ip' })
  assert.equal(fetched, 1)
  const offline = await resolveRegion({ question: 'latest ferry notice', myRegion: '', offlineOnly: true, geoText: GEO, fetchImpl: async () => { throw new Error('network') } })
  assert.equal(offline.source, 'global')
  assert.equal(offline.code, 'GLOBAL')
  const missing = await resolveRegion({ question: 'latest ferry notice', myRegion: '   ', offlineOnly: false, geoText: null, fetchImpl: async () => new Response('8.8.8.8') })
  assert.equal(missing.source, 'global')
})

test('finance maths stays in code and the disclaimer refuses buy or sell advice', () => {
  assert.equal(simpleReturn(100, 110), 0.1)
  assert.ok(Math.abs(cagr(100, 121, 2) - 0.1) < 1e-9)
  const sip = sipFutureValue(5000, 0.12, 12)
  assert.ok(Math.abs(sip - 63412.51506598475) < 1e-6)
  const rate = xirr([{ amount: -1000, date: '2024-01-01' }, { amount: 1100, date: '2025-01-01' }])
  assert.ok(rate != null && Math.abs(rate - 0.1) < 1e-3)
  assert.deepEqual(profitLoss(10, 100, 120), { pnl: 200, pct: 0.2 })
  const long = indiaEquityTax(200_000, 400)
  assert.equal(long.kind, 'ltcg')
  assert.equal(long.tax, (200_000 - 125_000) * 0.125)
  const rows = parseAmfiNav('120503;INF1;INF2;Harbor Growth;42.5;16-Oct-2026\nAMC banner\n')
  assert.equal(rows[0]?.nav, 42.5)
  assert.equal(parseBhavCsv('SYMBOL,CLOSE,DATE\nTCS,4000.5,2026-10-15')[0]?.close, 4000.5)
  assert.equal(parseRss('<rss><channel><item><title>Rate</title><link>https://rbi.org.in/a</link><pubDate>Thu, 16 Oct 2026</pubDate></item></channel></rss>')[0]?.title, 'Rate')
  assert.match(FINANCE_DISCLAIMER, /not a recommendation to buy or sell/)
  assert.doesNotMatch(FINANCE_DISCLAIMER, /you should buy|you should sell/i)
})

test('composed finance and legal answers cite a source and keep the disclaimer', async () => {
  const region = { code: 'GLOBAL', label: 'worldwide sources', source: 'global' as const }
  const sip = await composeRouted({
    question: 'What is the future value of a SIP of 5000 per month at 12% for 12 months?',
    hits: [],
    region,
    offlineOnly: true,
    webAllowed: false,
  })
  assert.ok(sip)
  assert.match(sip.text, /63412\.52/)
  assert.match(sip.text, /\[S1\]/)
  assert.match(sip.text, /Showing results for worldwide sources/)
  assert.match(sip.text, /not a recommendation to buy or sell/)
  assert.equal(citationProblems(sip.text, sip.citations).length, 0)
  const legal = legalAnswer({ title: 'Harbor Act', url: '', text: 'Section 4. The harbor master shall fly code GL-2201 when the channel is open.', pack: 'library' }, region)
  assert.match(legal.text, /GL-2201/)
  assert.match(legal.text, /\[S1\]/)
  assert.match(legal.text, new RegExp(LEGAL_DISCLAIMER))
  const quoted = quoteFromHits('What does section 4 of the Harbor Act say?', [hit('files', 'Section 4. The harbor master shall fly code GL-2201 when the channel is open.')])
  assert.match(quoted?.text || '', /GL-2201/)
  const extra: LegalProvider = { id: 'zz-code', regions: ['ZZ'], searchUrl: () => 'https://example.com/zz', parse: () => [] }
  assert.deepEqual(providersFor('ZZ', [extra]).map((item) => item.id), ['zz-code'])
  assert.equal(providersFor('GLOBAL').length, 0)
  const html = '<a href="https://www.indiacode.nic.in/handle/1">Harbor Act</a> Section 4. Fly GL-2201.'
  assert.equal(parseIndiaCode(html, 'https://www.indiacode.nic.in/simple-search')[0]?.title, 'Harbor Act')
  assert.match(packVersionLine([{ pack: 'General starter', version: '2026.10.10' }]), /2026\.10\.10/)
  assert.match(ensureCitationMarkers('The code is GL-2201.', [{ title: 'Harbor Act' }]), /\[S1\] Harbor Act/)
})

test('page reading strips trackers and calls the hidden window only when the article is short', async () => {
  const html = `<html><head><title>Pier</title><script src="https://www.googletagmanager.com/gtm.js"></script></head><body><article><h1>Pier note</h1><p>${'The harbor lantern code is GL-2201. '.repeat(40)}</p><img src="https://doubleclick.net/pixel.gif" width="1" height="1"></article></body></html>`
  const cleaned = stripTrackers(html)
  assert.equal(cleaned.includes('googletagmanager'), false)
  assert.equal(cleaned.includes('doubleclick'), false)
  const page = pageToMarkdown(html, 'https://example.com/pier')
  assert.match(page.markdown, /GL-2201/)
  assert.equal(page.markdown.includes('googletagmanager'), false)
  assert.equal(page.jsNeeded, false)
  let rendered = 0
  const short = await readPage('https://example.com/short', {
    offlineOnly: false,
    html: '<html><body><p>Hi</p></body></html>',
    jsRender: async () => { rendered += 1; return `<html><body><article><p>${'Loaded by script. '.repeat(40)}</p></article></body></html>` },
  })
  assert.equal(rendered, 1)
  assert.match(short?.markdown || '', /Loaded by script/)
})

test('gather keeps going when DuckDuckGo and a connector fail', async () => {
  resetRateLimits()
  let calls = 0
  const fetched = await gatherOnline({
    question: 'harbor lantern wikipedia',
    region: { code: 'GLOBAL', label: 'worldwide sources', source: 'global' },
    offlineOnly: false,
    db: null,
    fetchImpl: async (url) => {
      calls += 1
      const value = String(url)
      if (value.includes('wikipedia')) return jsonResponse({ query: { search: [] } })
      if (value.includes('hn.algolia')) return new Response('no', { status: 429 })
      if (value.includes('duckduckgo')) throw new Error('blocked')
      return new Response('no', { status: 404 })
    },
  })
  assert.equal(fetched.pages.length, 0)
  assert.ok(calls > 0)
})

test('a news question with no fetched row does not call the model', async () => {
  resetRateLimits()
  const region = { code: 'GLOBAL', label: 'worldwide sources', source: 'global' as const }
  const missed = await composeRouted({
    question: 'latest harbor news headlines',
    hits: [],
    region,
    offlineOnly: false,
    webAllowed: true,
    now: Date.parse('2026-10-16T12:00:00.000Z'),
    fetchImpl: async () => new Response('no', { status: 503 }),
  })
  assert.ok(missed)
  assert.equal(missed.citations.length, 0)
  assert.match(missed.text, new RegExp(UNABLE_NEWS))
  const kept = await composeRouted({
    question: 'latest harbor news headlines',
    hits: [{ layer: 'files', title: 'Harbor note', text: 'The harbor notice says the channel is open.', url: '', pack: 'library', score: 1 }],
    region,
    offlineOnly: true,
    webAllowed: false,
    now: Date.parse('2026-10-16T12:00:00.000Z'),
  })
  assert.ok(kept)
  assert.match(kept.text, /channel is open/)
  assert.equal(kept.text.includes(UNABLE_NEWS), false)
})

test('production search does not enable the eval fixture', () => {
  assert.equal(searchFixtureEnabled({}), false)
  assert.equal(searchFixtureEnabled({ SURF_SEARCH_FIXTURE: '1' }), true)
})

test('a host rate limit skips the next call', () => {
  resetRateLimits()
  assert.equal(takeToken('example.com', 1, 1_000), true)
  assert.equal(takeToken('example.com', 1, 1_500), false)
  assert.equal(takeToken('example.com', 1, 70_000), true)
})
