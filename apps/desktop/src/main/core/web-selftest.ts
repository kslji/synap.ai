/**
 * Local search fixture for SURF_SELFTEST.
 * A tiny HTTP server stands in for SearXNG and the page. The real FastAPI app proxies it.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fetchPages, searchWeb, type SearchResult } from './web-client.js'
import { decideWeb, parseSearchQueries, refusalMessage, refuseHint, rewritePrompt } from './web-decision.js'

export const BEACON_QUESTION = 'What is the Surf beacon code for pier 9 today?'
export const BEACON_CODE = 'SB-4417'

const BEACON_HTML = `<!doctype html>
<html><head><title>Pier 9 beacon</title>
<meta property="article:published_time" content="2026-10-09">
</head><body><article>
<h1>Pier 9 beacon</h1>
<p>The Surf beacon code for pier 9 today is ${BEACON_CODE}. Posted 9 October 2026.</p>
</article></body></html>`

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('fixture port missing'))
    })
  })
}

export function repoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'services', 'api', 'app', 'main.py'))) return dir
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  throw new Error('services/api not found from ' + process.cwd())
}

export async function startSearchFixture(): Promise<{ base: string; stop: () => Promise<void> }> {
  const fixture = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    if (path === '/search') {
      const port = fixture.address()
      const n = port && typeof port === 'object' ? port.port : 0
      const body = JSON.stringify({
        results: [{
          title: 'Pier 9 beacon',
          url: `http://127.0.0.1:${n}/beacon`,
          content: `The Surf beacon code for pier 9 today is ${BEACON_CODE}.`,
          publishedDate: '2026-10-09',
        }],
      })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(body)
      return
    }
    if (path === '/beacon') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(BEACON_HTML)
      return
    }
    res.writeHead(404)
    res.end('missing')
  })
  const fixturePort = await listen(fixture)
  const apiPort = await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address()
      probe.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port)
        else reject(new Error('api port missing'))
      })
    })
  })
  const root = repoRoot()
  const child: ChildProcess = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--app-dir', join(root, 'services', 'api'), '--host', '127.0.0.1', '--port', String(apiPort)], {
    env: {
      ...process.env,
      SURF_API_LITE: '1',
      SEARXNG_URL: `http://127.0.0.1:${fixturePort}/search`,
      FETCH_ALLOW_HOSTS: '127.0.0.1',
      JWT_SECRET: 'selftest-secret-selftest-secret-selftest',
      JWT_AUDIENCE: 'authenticated',
      SEARCH_PER_MIN: '30',
      SEARCH_PER_DAY: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout?.on('data', (buf: Buffer) => { log += buf.toString() })
  child.stderr?.on('data', (buf: Buffer) => { log += buf.toString() })
  const base = `http://127.0.0.1:${apiPort}`
  const stop = async () => {
    if (!child.killed) child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) resolve()
      else child.once('exit', () => resolve())
    })
    await new Promise<void>((resolve) => fixture.close(() => resolve()))
  }
  try {
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error(`api exited\n${log}`)
      try {
        const res = await fetch(`${base}/v1/health`)
        if (res.ok) return { base, stop }
      } catch { /* still booting */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`api health timeout\n${log}`)
  } catch (error) {
    await stop()
    throw error
  }
}

export async function loginDev(base: string, email: string, deviceUid = 'selftest-web'): Promise<string> {
  const start = await fetch(`${base}/v1/auth/otp/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const started = await start.json() as { dev_code?: string; error?: { message?: string } }
  if (!start.ok || !started.dev_code) throw new Error(started.error?.message || `dev OTP missing (${start.status})`)
  const verify = await fetch(`${base}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      code: started.dev_code,
      device: { device_uid: deviceUid, name: 'Selftest', os: 'linux', arch: 'x64', app_version: '0.1.0' },
    }),
  })
  const body = await verify.json() as { access_token?: string; error?: { message?: string } }
  if (!verify.ok || !body.access_token) throw new Error(body.error?.message || `OTP verify failed (${verify.status})`)
  return body.access_token
}

export async function searchBeacon(base: string, rewriteRaw: string): Promise<{ queries: string[]; text: string; title: string; url: string; published: string | null }> {
  const queries = parseSearchQueries(rewriteRaw, BEACON_QUESTION)
  const token = await loginDev(base, 'beacon@example.com')
  const results: SearchResult[] = []
  for (const query of queries) {
    results.push(...await searchWeb({ base, token, offlineOnly: false, query, k: 3 }))
  }
  const urls = [...new Set(results.map((item) => item.url))].slice(0, 3)
  const chunks = await fetchPages({ base, token, offlineOnly: false, urls })
  const hit = chunks.find((chunk) => chunk.text.includes(BEACON_CODE))
  if (!hit) throw new Error(`fetched pages missing ${BEACON_CODE}: ${chunks.map((c) => c.text).join(' ').slice(0, 240)}`)
  return { queries, text: hit.text, title: hit.title || 'Pier 9 beacon', url: hit.url, published: hit.published }
}

export function offlineRefusal(): { branch: string; message: string; prompt: string } {
  const plan = decideWeb({ local: 'insufficient', fresh: true, online: true, offlineOnly: true, webAllowed: true })
  return {
    branch: plan.branch,
    message: refusalMessage(plan.hint ?? refuseHint({ offlineOnly: true, online: true })),
    prompt: rewritePrompt(BEACON_QUESTION),
  }
}
