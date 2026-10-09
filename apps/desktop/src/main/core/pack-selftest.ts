/**
 * Self-test: dev OTP login, sync the general starter pack, answer from it, then answer again with the API stopped.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openPackDb } from './db.js'
import { EMBEDDINGGEMMA2_256, Embedder } from './embedding.js'
import { LlamaClient } from './llama-client.js'
import { LlamaServer } from './sidecar-manager.js'
import { commitInstall } from './pack-install.js'
import { downloadFile, fetchCatalog } from './pack-sync.js'
import { verifyPack } from './pack-verify.js'
import { hybridSearch } from './retrieval.js'
import { loginDev, repoRoot } from './web-selftest.js'

export const LANTERN_QUESTION = 'What is the harbor lantern code?'
export const LANTERN_CODE = 'GL-2201'

async function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout?.on('data', (buf: Buffer) => { out += buf.toString() })
    child.stderr?.on('data', (buf: Buffer) => { out += buf.toString() })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve(out.trim())
      else reject(new Error(`${cmd} ${args[0]} exited ${code}\n${out}`))
    })
  })
}

export async function provePack(opts: {
  bin: string
  embGguf: string
  chatGguf: string
  logDir: string
}): Promise<string> {
  const root = repoRoot()
  const work = mkdtempSync(join(tmpdir(), 'surf-pack-selftest-'))
  const packRoot = join(work, 'catalog')
  const version = '2026.10.09'
  const built = join(packRoot, 'general-starter', version)
  const seed = randomBytes(32).toString('hex')
  const pub = await run('python3', ['-c', 'import os; from nacl.signing import SigningKey; print(SigningKey(bytes.fromhex(os.environ["SEED"])).verify_key.encode().hex())'], { ...process.env, SEED: seed })
  const embed = new LlamaServer({
    binPath: opts.bin,
    modelPath: opts.embGguf,
    embeddings: true,
    pooling: 'mean',
    ctx: 2048,
    logFile: join(opts.logDir, 'pack-embed.log'),
    startupTimeoutMs: 180_000,
  })
  await embed.start()
  let embedStopped = false
  let api: { base: string; stop: () => Promise<void> } | null = null
  try {
    await run('python3', [
      join(root, 'services', 'packs', 'build_pack.py'),
      '--src', join(root, 'services', 'packs', 'general-starter'),
      '--out', built,
      '--key-hex', seed,
      '--key-id', 'k-selftest',
      '--embed-url', `${embed.baseUrl}/v1/embeddings`,
      '--api-key', embed.apiKey,
    ], process.env)
    api = await startPackApi(packRoot)
    const access = await loginDev(api.base, 'pack@example.com', 'selftest-pack')
    const { safeStorage } = await import('electron')
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : 'os'
    let keychain = `backend=${backend}`
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      const blob = await safeStorage.encryptStringAsync(access)
      const back = (await safeStorage.decryptStringAsync(blob)).result
      if (back !== access) throw new Error('session keychain round-trip failed')
      keychain += ', round-trip ok'
    }
    const catalog = await fetchCatalog(api.base, access, '')
    const pack = catalog.find((row) => row.id === 'general-starter')
    if (!pack) throw new Error(`catalog missing starter: ${JSON.stringify(catalog)}`)
    const staging = join(work, 'staging')
    const { mkdir, rm } = await import('node:fs/promises')
    await rm(staging, { recursive: true, force: true })
    await mkdir(staging, { recursive: true })
    for (const file of pack.latest.files) {
      await downloadFile(file.url, join(staging, file.name), {})
    }
    const manifest = await verifyPack(staging, {
      trustedKeys: { 'k-selftest': pub },
      expectedEmbedding: EMBEDDINGGEMMA2_256,
    })
    const installedRoot = join(work, 'installed')
    const finalDir = await commitInstall(staging, installedRoot, manifest, pack.title)
    const db = openPackDb(join(finalDir, 'pack.sqlite'))
    let online = ''
    try {
      const embedder = new Embedder(new LlamaClient({ baseUrl: embed.baseUrl, apiKey: embed.apiKey }))
      const [qvec] = await embedder.embedQueries([LANTERN_QUESTION])
      const label = `${pack.title} · ${manifest.version}`
      const found = hybridSearch({ [label]: db }, LANTERN_QUESTION, qvec)
      const top = found.top[0]
      if (!top || !top.text.includes(LANTERN_CODE)) throw new Error(`pack search missed ${LANTERN_CODE}: ${top?.text ?? 'none'} gate=${found.decision}`)
      if (found.decision === 'insufficient') throw new Error(`pack gate insufficient cos=${top.cosine.toFixed(3)}`)
      await api.stop()
      api = null
      const offlineFound = hybridSearch({ [label]: db }, LANTERN_QUESTION, qvec)
      const offlineTop = offlineFound.top[0]
      if (!offlineTop?.text.includes(LANTERN_CODE)) throw new Error(`offline pack search missed ${LANTERN_CODE}`)
      await embed.stop()
      embedStopped = true
      const chat = new LlamaServer({
        binPath: opts.bin,
        modelPath: opts.chatGguf,
        ctx: 4096,
        logFile: join(opts.logDir, 'pack-chat.log'),
        startupTimeoutMs: 180_000,
      })
      await chat.start()
      try {
        online = await ask(chat, top.text, label, top.title)
        const again = await ask(chat, offlineTop.text, label, offlineTop.title)
        if (!again.includes(LANTERN_CODE)) throw new Error(`offline pack answer missing ${LANTERN_CODE}: ${again}`)
        return `login ok; ${keychain}; installed ${manifest.pack_id}@${manifest.version}; cos=${top.cosine.toFixed(3)} gate=${found.decision}; online="${online.replace(/\s+/g, ' ')}"; offline="${again.replace(/\s+/g, ' ')}"`
      } finally {
        await chat.stop()
      }
    } finally {
      db.close()
    }
  } finally {
    if (api) await api.stop()
    if (!embedStopped) await embed.stop().catch(() => undefined)
    rmSync(work, { recursive: true, force: true })
  }
}

async function ask(chat: LlamaServer, text: string, pack: string, title: string): Promise<string> {
  const client = new LlamaClient({ baseUrl: chat.baseUrl, apiKey: chat.apiKey })
  const res = await client.chat([{
    role: 'system',
    content: 'Answer using only the sources. Cite the source as [S1]. Quote the lantern code exactly.',
  }, {
    role: 'user',
    content: `SOURCES:\n[S1] ${pack} · ${title}\n${text}\n\nQuestion: ${LANTERN_QUESTION}`,
  }], undefined, undefined, 160)
  const answer = String(res.choices[0]?.message?.content ?? '').trim()
  if (!answer.includes(LANTERN_CODE)) throw new Error(`pack answer missing ${LANTERN_CODE}: ${answer}`)
  if (!/\[S1\]/.test(answer)) throw new Error(`pack answer missing citation: ${answer}`)
  return answer
}

async function startPackApi(packRoot: string): Promise<{ base: string; stop: () => Promise<void> }> {
  const { createServer } = await import('node:http')
  const health = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  const healthPort = await new Promise<number>((resolve, reject) => {
    health.listen(0, '127.0.0.1', () => {
      const addr = health.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('health port missing'))
    })
  })
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
  const child = spawn('python3', ['-m', 'uvicorn', 'app.main:app', '--app-dir', join(root, 'services', 'api'), '--host', '127.0.0.1', '--port', String(apiPort)], {
    env: {
      ...process.env,
      SURF_API_LITE: '1',
      SEARXNG_URL: `http://127.0.0.1:${healthPort}/search`,
      FETCH_ALLOW_HOSTS: '',
      JWT_SECRET: 'selftest-secret-selftest-secret-selftest',
      JWT_AUDIENCE: 'authenticated',
      MAIL_MODE: 'console',
      PACK_ROOT: packRoot,
      PACK_BACKEND: 'file',
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
    await new Promise<void>((resolve) => health.close(() => resolve()))
  }
  try {
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error(`pack api exited\n${log}`)
      try {
        const res = await fetch(`${base}/v1/health`)
        if (res.ok) return { base, stop }
      } catch { /* booting */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`pack api health timeout\n${log}`)
  } catch (error) {
    await stop()
    throw error
  }
}
