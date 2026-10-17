/**
 * Granted-folder search. Reads happen only after a grant.
 * Spotlight on macOS, Windows Search on Windows, and a walker everywhere else.
 * Embeddings use EmbeddingGemma when that model is already installed.
 * Otherwise the index uses the local hashed embedder and still keeps the keyword index.
 */
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { hashEmbedder, type CodeEmbedder } from '../code/embed.js'
import { composeFileAnswer, type FileAnswer } from './answer.js'
import type { ExtractOpts } from './extract.js'
import { createWatcher, indexGrant, type WatchFn } from './indexer.js'
import { classifyAccessError, settingsLink, type OsDenial, type OsDenialKind } from './os-access.js'
import { displayPath, normalizePath, pathStyleOf, type PathStyle } from './paths.js'
import {
  canReadPath,
  classifyFileAsk,
  grantAllowed,
  planAccess,
  suggestedFolders,
  type FileAsk,
  type GrantScope,
  type SuggestedFolder,
} from './permissions.js'
import { searchFileNames, type CommandRunner, type NameEngine } from './search-adapters.js'
import {
  chunkCount,
  dropSessionGrants,
  getGrant,
  listGrants,
  metaGet,
  metaSet,
  openFileDb,
  revokeGrant,
  searchChunks,
  updateGrantProgress,
  upsertGrant,
  type FileDb,
  type GrantRow,
} from './store.js'

export interface FileTurnAsk {
  kind: 'ask'
  prompt: { id: string; messageId: string; label: string; path: string; question: string }
}

export interface FileTurnAnswer {
  kind: 'answer'
  answer: FileAnswer
  engine: NameEngine | 'index'
}

export type FileTurn = { kind: 'skip' } | FileTurnAsk | FileTurnAnswer

export interface FileSearchDeps {
  dbPath: string
  keyHex: string | null
  home: string
  platform: string
  grammarDir?: string
  tessdataDir?: string
  tessCacheDir?: string
  ocr?: ExtractOpts['ocr']
  tryGemma?: () => Promise<CodeEmbedder | null>
  run?: CommandRunner
  spotlight?: boolean
  windowsSearch?: boolean
  watch?: WatchFn
  debounceMs?: number
  sleep?: (ms: number) => Promise<void>
  onProgress?: (progress: { grantId: string; path: string; done: number; total: number; byteSize: number; status: string; error: string | null }) => void
  openPath?: (filePath: string) => Promise<void>
  now?: () => number
}

export interface FileSearchService {
  list(): GrantRow[]
  suggestions(): SuggestedFolder[]
  chunks(grantId?: string): number
  grant(folder: string, scope: GrantScope): Promise<GrantRow>
  revoke(id: string): void
  answerQuestion(question: string, messageId: string): Promise<FileTurn>
  open(filePath: string): Promise<void>
  settingsUrl(kind: OsDenialKind): string
  bytes(): number
  wipe(): Promise<void>
  close(): void
}

export function createFileSearch(deps: FileSearchDeps): FileSearchService {
  const style = pathStyleOf(deps.platform)
  let db: FileDb | null = openOwned()
  const watches = new Map<string, { close: () => void }>()
  let chain: Promise<void> = Promise.resolve()
  let closed = false

  function openOwned(): FileDb {
    const opened = openFileDb(deps.dbPath, deps.keyHex)
    dropSessionGrants(opened)
    return opened
  }

  function database(): FileDb {
    if (closed || !db) throw new Error('File search is closed.')
    return db
  }

  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  async function embedder(): Promise<CodeEmbedder> {
    const saved = metaGet(database(), 'embedder')
    if (saved === 'gemma' && deps.tryGemma) {
      const ready = await deps.tryGemma().catch(() => null)
      if (ready) return ready
    }
    if (!saved && deps.tryGemma) {
      const ready = await deps.tryGemma().catch(() => null)
      if (ready) {
        metaSet(database(), 'embedder', 'gemma')
        return ready
      }
    }
    if (saved !== 'gemma') metaSet(database(), 'embedder', 'hash')
    return hashEmbedder()
  }

  function watchGrant(row: GrantRow): void {
    if (watches.has(row.id)) return
    const handle = createWatcher(row.path, () => {
      void enqueue(() => reindex(row.id)).catch(() => undefined)
    }, deps.watch, deps.debounceMs ?? 1500)
    watches.set(row.id, handle)
  }

  async function reindex(id: string): Promise<GrantRow | null> {
    const row = getGrant(database(), id)
    if (!row) return null
    const probe = probeFolder(row.path, deps.platform)
    if (!probe.ok) {
      updateGrantProgress(database(), id, { status: 'error', error: probe.denial?.message ?? probe.message })
      return getGrant(database(), id)
    }
    const vectors = await embedder()
    await indexGrant(database(), id, row.path, {
      style,
      roots: [row.path],
      embedder: vectors,
      extract: extractOpts([row.path]),
      sleep: deps.sleep,
      onProgress: (progress) => deps.onProgress?.(progress),
    })
    console.info(`[surf] file index files=${getGrant(database(), id)?.indexedCount ?? 0}`)
    return getGrant(database(), id)
  }

  function extractOpts(roots: string[]): ExtractOpts {
    return {
      style,
      roots,
      grammarDir: deps.grammarDir,
      tessdataDir: deps.tessdataDir,
      tessCacheDir: deps.tessCacheDir,
      ocr: deps.ocr,
    }
  }

  return {
    list: () => listGrants(database()),
    suggestions: () => suggestedFolders(deps.home, style),
    chunks: (grantId?: string) => chunkCount(database(), grantId),
    grant(folder, scope) {
      return enqueue(async () => {
        const allowed = grantAllowed(folder, style)
        if (!allowed.ok) throw new Error(allowed.reason)
        const id = grantIdFor(folder, style)
        const label = displayPath(folder, deps.home, style)
        upsertGrant(database(), { id, path: folder, label, scope, grantedAt: deps.now?.() ?? Date.now() })
        watchGrant({ id, path: folder, label, scope, grantedAt: 0, lastIndexedAt: null, fileCount: 0, indexedCount: 0, byteSize: 0, status: 'idle', error: null })
        const row = await reindex(id)
        if (!row) throw new Error('That folder was not saved.')
        return row
      })
    },
    revoke(id) {
      watches.get(id)?.close()
      watches.delete(id)
      revokeGrant(database(), id)
    },
    async answerQuestion(question, messageId) {
      const ask = classifyFileAsk(question)
      if (!ask) return { kind: 'skip' }
      const grants = listGrants(database())
      const plan = planAccess(ask, grants, suggestedFolders(deps.home, style), deps.home, style)
      if (plan.action === 'refuse') {
        return { kind: 'answer', engine: 'index', answer: { text: plan.text, citations: [], gate: 'insufficient' } }
      }
      if (plan.action === 'ask') {
        return {
          kind: 'ask',
          prompt: { id: messageId, messageId, label: plan.label, path: plan.path, question: plan.text },
        }
      }
      return { kind: 'answer', engine: 'index', answer: await searchGranted(ask, plan.roots) }
    },
    async open(filePath) {
      const roots = listGrants(database()).map((row) => row.path)
      if (!canReadPath(filePath, roots, style)) throw new Error('Synap.surf does not have permission to open that file.')
      if (deps.openPath) await deps.openPath(filePath)
    },
    settingsUrl: (kind) => settingsLink(kind),
    bytes() {
      try { return statSync(deps.dbPath).size } catch { return 0 }
    },
    async wipe() {
      for (const handle of watches.values()) handle.close()
      watches.clear()
      db?.close()
      db = null
      await rm(deps.dbPath, { force: true })
      const sidecar = `${deps.dbPath}-wal`
      await rm(sidecar, { force: true })
      await rm(`${deps.dbPath}-shm`, { force: true })
      if (!closed) db = openOwned()
    },
    close() {
      closed = true
      for (const handle of watches.values()) handle.close()
      watches.clear()
      db?.close()
      db = null
    },
  }

  async function searchGranted(ask: FileAsk, roots: string[]): Promise<FileAnswer> {
    const rows = listGrants(database()).filter((row) => roots.includes(row.path))
    const vectors = await embedder()
    const [qvec] = await vectors.embedQueries([ask.query])
    const hits = searchChunks(database(), ask.query, qvec, rows.map((row) => row.id), 5)
    const answer = composeFileAnswer(ask.query, hits, deps.home, style)
    if (!answer.citations.length) {
      const names = await searchFileNames({
        query: ask.query,
        roots,
        style,
        platform: deps.platform,
        spotlight: deps.spotlight ?? deps.platform === 'darwin',
        windowsSearch: deps.windowsSearch ?? deps.platform === 'win32',
        run: deps.run ?? spawnCommand,
      })
      if (names.hits.length) {
        const listed = names.hits.slice(0, 4).map((hit) => displayPath(hit.path, deps.home, style))
        return {
          text: `I found these names, and the text index does not have a passage yet:\n${listed.map((item, index) => `[S${index + 1}] ${item}`).join('\n')}`,
          citations: names.hits.slice(0, 4).map((hit) => ({
            kind: 'document' as const,
            title: displayPath(hit.path, deps.home, style),
            url: '',
            pack: 'your files',
            fileName: hit.name,
            filePath: hit.path,
            excerpt: hit.name,
          })),
          gate: 'answer',
        }
      }
    }
    return answer
  }
}

function probeFolder(folder: string, platform: string): { ok: true } | { ok: false; message: string; denial: OsDenial | null } {
  try {
    const info = statSync(folder)
    if (!info.isDirectory()) return { ok: false, message: 'Choose a folder.', denial: null }
    return { ok: true }
  } catch (error) {
    const denial = classifyAccessError(error, folder, platform)
    return { ok: false, message: denial?.message ?? 'Could not read that folder.', denial }
  }
}

function grantIdFor(folder: string, style: PathStyle): string {
  return createHash('sha256').update(normalizePath(folder, style)).digest('hex').slice(0, 16)
}

export function spawnCommand(command: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, args, { shell: false, windowsHide: true })
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish({ code: 124, stdout, stderr: stderr || 'timed out' })
    }, timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { if (stdout.length < 200_000) stdout += chunk })
    child.stderr?.on('data', (chunk: string) => { if (stderr.length < 20_000) stderr += chunk })
    child.on('error', (error) => finish({ code: 127, stdout, stderr: error.message }))
    child.on('close', (code) => finish({ code: code ?? 1, stdout, stderr }))
  })
}

export function chunkCountFor(servicePath: string, keyHex: string | null, grantId?: string): number {
  const db = openFileDb(servicePath, keyHex)
  try { return chunkCount(db, grantId) } finally { db.close() }
}
