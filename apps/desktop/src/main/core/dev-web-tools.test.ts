import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeAgentDevWebTools } from './code-agent/dev-web-hook.js'
import {
  DEV_API_URL,
  devWebEnabled,
  devWebToolSchemas,
  devWebTools,
  parseDevWebCommand,
  resolveSynapApiUrl,
  robotsAllows,
  stripScripts,
  type DevWebHost,
} from './dev-web-tools.js'

const PRODUCTION = { NODE_ENV: 'production' }
const DEVELOPMENT = { NODE_ENV: 'development' }
const PUBLIC = async () => ['93.184.216.34']

function host(over: Partial<DevWebHost> & { env: DevWebHost['env'] }): DevWebHost {
  return { apiBase: DEV_API_URL, offlineOnly: false, resolveHost: PUBLIC, ...over }
}

test('dev web tools are absent unless development or SYNAP_DEV_WEB', () => {
  assert.equal(devWebEnabled(PRODUCTION), false)
  assert.equal(devWebEnabled({ NODE_ENV: 'test' }), false)
  assert.equal(devWebEnabled(DEVELOPMENT), true)
  assert.equal(devWebEnabled({ NODE_ENV: 'production', SYNAP_DEV_WEB: '1' }), true)
  assert.equal(devWebTools(host({ env: PRODUCTION })).length, 0)
  assert.deepEqual(devWebToolSchemas(PRODUCTION), [])
  assert.equal(codeAgentDevWebTools(host({ env: PRODUCTION })).length, 0)
  const names = devWebTools(host({ env: DEVELOPMENT })).map((tool) => tool.name)
  assert.deepEqual(names, ['web_search', 'fetch_page'])
  assert.deepEqual(devWebToolSchemas({ SYNAP_DEV_WEB: '1' }).map((schema) => (schema as { function: { name: string } }).function.name), names)
})

test('tool schemas match the Code agent loop shape', () => {
  const [search, page] = devWebTools(host({ env: DEVELOPMENT }))
  const searchSchema = search.schema as { type: string; function: { name: string; parameters: { required: string[] } } }
  const pageSchema = page.schema as { type: string; function: { name: string; parameters: { required: string[] } } }
  assert.equal(searchSchema.type, 'function')
  assert.equal(searchSchema.function.name, 'web_search')
  assert.deepEqual(searchSchema.function.parameters.required, ['query'])
  assert.equal(pageSchema.function.name, 'fetch_page')
  assert.deepEqual(pageSchema.function.parameters.required, ['url'])
})

test('SYNAP_API_URL defaults to localhost in dev and stays unused in packaged builds', () => {
  const settings = 'https://api.synap.surf'
  assert.equal(resolveSynapApiUrl({ packaged: false, settingsUrl: settings, env: DEVELOPMENT }), DEV_API_URL)
  assert.equal(resolveSynapApiUrl({ packaged: true, settingsUrl: settings, env: DEVELOPMENT }), settings)
  assert.equal(resolveSynapApiUrl({ packaged: true, settingsUrl: settings, env: PRODUCTION }), settings)
  assert.equal(
    resolveSynapApiUrl({ packaged: true, settingsUrl: settings, env: { ...PRODUCTION, SYNAP_API_URL: 'http://127.0.0.1:9000/' } }),
    'http://127.0.0.1:9000',
  )
  assert.equal(
    resolveSynapApiUrl({ packaged: false, settingsUrl: settings, env: { ...DEVELOPMENT, SURF_API_BASE: 'http://127.0.0.1:9' } }),
    'http://127.0.0.1:9',
  )
  assert.equal(resolveSynapApiUrl({ packaged: false, settingsUrl: settings, env: PRODUCTION }), settings)
})

test('chat commands', () => {
  assert.deepEqual(parseDevWebCommand('/web pier beacon'), { tool: 'web_search', query: 'pier beacon' })
  assert.deepEqual(parseDevWebCommand('/fetch https://example.com/a'), { tool: 'fetch_page', url: 'https://example.com/a' })
  assert.equal(parseDevWebCommand('what is /web'), null)
  assert.equal(parseDevWebCommand('/fetch'), null)
})

test('robots.txt allow and disallow', () => {
  const star = 'User-agent: *\nDisallow: /secret\n'
  assert.equal(robotsAllows(star, 'https://example.com/secret'), false)
  assert.equal(robotsAllows(star, 'https://example.com/ok'), true)
  const specific = 'User-agent: *\nDisallow: /\n\nUser-agent: SynapSurf\nDisallow: /private\n'
  assert.equal(robotsAllows(specific, 'https://example.com/public'), true)
  assert.equal(robotsAllows(specific, 'https://example.com/private/note'), false)
  assert.equal(robotsAllows('User-agent: *\nAllow: /public\nDisallow: /\n', 'https://example.com/public/a'), true)
  assert.equal(robotsAllows('', 'https://example.com/anything'), true)
})

test('strip scripts removes script and style text', () => {
  const html = '<p>Visible beacon.</p><script>SECRET_TOKEN_abc</script><style>.x{color:red}</style>'
  const stripped = stripScripts(html)
  assert.equal(stripped.includes('SECRET_TOKEN_abc'), false)
  assert.equal(stripped.includes('color:red'), false)
  assert.equal(stripped.includes('Visible beacon.'), true)
})

test('web_search includes source URLs and does not send a token', async () => {
  const calls: string[] = []
  let auth: string | null = 'unset'
  const tools = devWebTools(host({
    env: DEVELOPMENT,
    fetchImpl: async (input, init) => {
      calls.push(String(input))
      auth = new Headers(init?.headers).get('authorization')
      return Response.json({
        results: [
          { title: 'Pier 9 beacon', url: 'https://example.com/beacon', snippet: 'SB-4417' },
          { title: 'DROP_ME', url: 'not-a-url', snippet: 'no' },
        ],
      })
    },
  }))
  const text = await tools[0].run({ query: 'pier beacon', k: 3 })
  assert.equal(calls[0]?.endsWith('/v1/search'), true)
  assert.equal(auth, null)
  assert.match(text, /URL: https:\/\/example\.com\/beacon/)
  assert.match(text, /SB-4417/)
  assert.equal(text.includes('DROP_ME'), false)
  assert.equal(text.includes('not-a-url'), false)
})

test('fetch_page returns the source URL, strips scripts, and honors robots.txt', async () => {
  const calls: string[] = []
  const html = '<html><head><title>Pier</title><script>SECRET_TOKEN_abc</script></head><body><p>Visible beacon.</p></body></html>'
  const fetchImpl: DevWebHost['fetchImpl'] = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/robots.txt')) {
      const body = url.includes('blocked.example')
        ? 'User-agent: *\nDisallow: /\n'
        : 'User-agent: *\nDisallow:\n'
      return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
  const tools = devWebTools(host({ env: { SYNAP_DEV_WEB: '1' }, fetchImpl, resolveHost: async () => ['93.184.216.34'] }))
  const page = tools.find((tool) => tool.name === 'fetch_page')
  assert.ok(page)
  const text = await page.run({ url: 'https://example.com/pier' })
  assert.match(text, /URL: https:\/\/example\.com\/pier/)
  assert.match(text, /Visible beacon/)
  assert.match(text, /Title: Pier/)
  assert.equal(text.includes('SECRET_TOKEN_abc'), false)
  const blocked = await page.run({ url: 'https://blocked.example/secret' })
  assert.match(blocked, /robots\.txt does not allow https:\/\/blocked\.example\/secret/)
  assert.equal(calls.some((url) => url.includes('blocked.example') && !url.endsWith('/robots.txt')), false)
})

test('fetch_page times out, caps size, and refuses private addresses', async () => {
  const calls: string[] = []
  const fetchImpl: DevWebHost['fetchImpl'] = (input, init) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/robots.txt')) return Promise.resolve(new Response('', { status: 404 }))
    if (url.includes('/slow')) {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    }
    if (url.includes('/big')) {
      return Promise.resolve(new Response(`SECRET_TOKEN_abc ${'x'.repeat(80)}`, { status: 200, headers: { 'content-type': 'text/html' } }))
    }
    return Promise.resolve(new Response('no', { status: 200 }))
  }
  const tools = devWebTools(host({ env: DEVELOPMENT, fetchImpl, timeoutMs: 30, maxBytes: 40 }))
  const page = tools[1]
  const slow = await page.run({ url: 'https://example.com/slow' })
  assert.match(slow, /timed out/)
  assert.match(slow, /https:\/\/example\.com\/slow/)
  const big = await page.run({ url: 'https://example.com/big' })
  assert.match(big, /too large/)
  assert.equal(big.includes('SECRET_TOKEN_abc'), false)
  const before = calls.length
  const local = await page.run({ url: 'http://127.0.0.1/secret' })
  assert.match(local, /not a public page/)
  assert.match(local, /127\.0\.0\.1/)
  assert.equal(calls.length, before)
  const meta = await page.run({ url: 'http://169.254.169.254/latest' })
  assert.match(meta, /not a public page/)
})

test('fetch_page does not follow a redirect to a private address', async () => {
  const calls: string[] = []
  const fetchImpl: DevWebHost['fetchImpl'] = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 })
    return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/secret' } })
  }
  const tools = devWebTools(host({ env: DEVELOPMENT, fetchImpl }))
  const text = await tools[1].run({ url: 'https://example.com/go' })
  assert.match(text, /not a public page/)
  assert.equal(calls.some((url) => url.includes('127.0.0.1')), false)
})

test('offline mode does not call the network', async () => {
  let calls = 0
  const tools = devWebTools(host({
    env: DEVELOPMENT,
    offlineOnly: true,
    fetchImpl: async () => { calls += 1; return new Response('no') },
  }))
  const search = await tools[0].run({ query: 'pier' })
  const page = await tools[1].run({ url: 'https://example.com/pier' })
  assert.match(search, /Offline only/)
  assert.match(page, /Offline only/)
  assert.equal(calls, 0)
})
