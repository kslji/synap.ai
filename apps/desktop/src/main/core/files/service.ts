/**
 * Granted-folder search. Reads happen only after a grant.
 * Spotlight on macOS, Windows Search on Windows, and a walker everywhere else.
 * Embeddings use EmbeddingGemma. The hashed embedder is only a temporary fallback.
 * When EmbeddingGemma becomes available, folders that used the fallback are re-embedded
 * in the background and switched in one transaction so the two vector spaces are never mixed.
 */
import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { FileSuggestFolder } from '../../../shared/ipc-contract.js'
import { hashEmbedder, type CodeEmbedder } from '../code/embed.js'
import { composeFileAnswer, composeNameAnswer, type FileAnswer } from './answer.js'
import type { ExtractOpts } from './extract.js'
import { createWatcher, INDEX_GAP_MS, indexGrant, type WatchFn } from './indexer.js'
import { readIndexLimits, rememberThroughput, writeIndexLimits, type IndexLimits } from './limits.js'
import { classifyAccessError, settingsLink, type OsDenial, type OsDenialKind } from './os-access.js'
import { displayPath, isInsideRoot, normalizePath, pathStyleOf, type PathStyle } from './paths.js'
import {
  canReadPath,
  classifyFileAsk,
  grantAllowed,
  planAccess,
  type FileAsk,
  type GrantScope,
} from './permissions.js'
import { livePlacesFs, suggestPlaces, type PlacesFs } from './suggestions.js'
import { searchFileNames, type CommandRunner, type NameEngine } from './search-adapters.js'
import {
  chunkCount,
  chunksForGrant,
  clearStage,
  commitStagedEmbeddings,
  dropSessionGrants,
  getGrant,
  listGrants,
  openFileDb,
  revokeGrant,
  searchChunks,
  stageEmbedding,
  updateGrantProgress,
  upsertGrant,
  type FileDb,
  type GrantRow,
  type RankedChunk,
} from './store.js'

export interface FileTurnAsk {
  kind: 'ask'
  prompt: { id: string; messageId: string; label: string; path: string; question: string; specific: boolean; note: string | null }
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
  placesFs?: PlacesFs
  onProgress?: (progress: { grantId: string; path: string; done: number; total: number; byteSize: number; status: string; error: string | null; phase: 'index' | 'embed'; filesPerSec?: number | null }) => void
  openPath?: (filePath: string) => Promise<void>
  now?: () => number
}

export interface FileSearchService {
  list(): GrantRow[]
  suggestions(): FileSuggestFolder[]
  chunks(grantId?: string): number
  grant(folder: string, scope: GrantScope): Promise<GrantRow>
  revoke(id: string): void
  pause(id: string): void
  resume(id: string): Promise<GrantRow | null>
  limits(): IndexLimits
  setLimits(patch: { maxFiles: number; extensions: string }): IndexLimits
  answerQuestion(question: string, messageId: string): Promise<FileTurn>
  upgradeEmbeddings(): Promise<void>
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
  const pausedIds = new Set<string>()
  let chain: Promise<void> = Promise.resolve()
  let closed = false

  function openOwned(): FileDb | null {
    try {
      const opened = openFileDb(deps.dbPath, deps.keyHex)
      dropSessionGrants(opened)
      return opened
    } catch (e) {
      // Database is corrupted or key is wrong - try to recover
      console.warn('[surf] file index database unavailable:', (e as Error).message)
      try {
        // Delete the corrupted database and try again
        const { rmSync } = require('node:fs')
        rmSync(deps.dbPath, { force: true })
        if (deps.keyHex) {
          // Try with encryption
          const opened = openFileDb(deps.dbPath, deps.keyHex)
          dropSessionGrants(opened)
          console.info('[surf] file index database recreated (encrypted)')
          return opened
        } else {
          // Try without encryption
          const opened = openFileDb(deps.dbPath, null)
          dropSessionGrants(opened)
          console.info('[surf] file index database recreated (plain)')
          return opened
        }
      } catch (recoveryError) {
        // Recovery failed - disable file search
        console.error('[surf] file index recovery failed:', (recoveryError as Error).message)
        return null
      }
    }
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

  async function vectorsFor(row: GrantRow): Promise<{ kind: 'gemma' | 'hash'; embedder: CodeEmbedder } | null> {
    const gemma = deps.tryGemma ? await deps.tryGemma().catch(() => null) : null
    if (gemma) return { kind: 'gemma', embedder: gemma }
    if (row.embedder === 'gemma' && chunkCount(database(), row.id) > 0) return null
    return { kind: 'hash', embedder: hashEmbedder() }
  }

  function watchGrant(row: { id: string; path: string }): void {
    if (watches.has(row.id)) return
    const handle = createWatcher(row.path, () => {
      void enqueue(() => reindex(row.id, 'watch')).catch(() => undefined)
    }, deps.watch, deps.debounceMs ?? 1500)
    watches.set(row.id, handle)
  }

  async function reindex(id: string, reason: 'grant' | 'watch' | 'resume'): Promise<GrantRow | null> {
    const row = getGrant(database(), id)
    if (!row) return null
    if (pausedIds.has(id) || (row.status === 'paused' && reason !== 'grant' && reason !== 'resume')) {
      if (row.status !== 'paused') updateGrantProgress(database(), id, { status: 'paused', error: null })
      return getGrant(database(), id)
    }
    const probe = probeFolder(row.path, deps.platform)
    if (!probe.ok) {
      updateGrantProgress(database(), id, { status: 'error', error: probe.denial?.message ?? probe.message })
      return getGrant(database(), id)
    }
    const vectors = await vectorsFor(row)
    if (!vectors) {
      updateGrantProgress(database(), id, { status: 'ready', error: null })
      return getGrant(database(), id)
    }
    const limits = readIndexLimits(database())
    const result = await indexGrant(database(), id, row.path, {
      style,
      roots: [row.path],
      embedder: vectors.embedder,
      embedderKind: vectors.kind,
      extract: extractOpts([row.path]),
      sleep: deps.sleep,
      maxFiles: limits.maxFiles,
      extensions: limits.extensions,
      paused: () => pausedIds.has(id),
      onProgress: (progress) => deps.onProgress?.({ ...progress, phase: 'index' }),
    })
    if (!result.paused) {
      rememberThroughput(database(), result.filesPerSec)
      console.info(`[surf] file index files=${result.files} perSec=${result.filesPerSec}`)
    }
    return getGrant(database(), id)
  }

  function suggestionRows(measure: boolean): FileSuggestFolder[] {
    const grants = listGrants(database()).map((row) => row.path)
    const fs = deps.placesFs ?? livePlacesFs(deps.home, style, deps.platform)
    return suggestPlaces({ home: deps.home, style, platform: deps.platform, fs, measure }).map((item) => ({
      ...item,
      granted: grants.some((grant) => isInsideRoot(grant, item.path, style)),
    }))
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
    suggestions: () => suggestionRows(true),
    chunks: (grantId?: string) => chunkCount(database(), grantId),
    grant(folder, scope) {
      return enqueue(async () => {
        const allowed = grantAllowed(folder, style)
        if (!allowed.ok) throw new Error(allowed.reason)
        const id = grantIdFor(folder, style)
        pausedIds.delete(id)
        const label = displayPath(folder, deps.home, style)
        upsertGrant(database(), { id, path: folder, label, scope, grantedAt: deps.now?.() ?? Date.now() })
        watchGrant({ id, path: folder })
        const row = await reindex(id, 'grant')
        if (!row) throw new Error('That folder was not saved.')
        return row
      })
    },
    revoke(id) {
      pausedIds.delete(id)
      watches.get(id)?.close()
      watches.delete(id)
      revokeGrant(database(), id)
    },
    pause(id) {
      pausedIds.add(id)
      const row = getGrant(database(), id)
      if (!row || row.status === 'paused') return
      updateGrantProgress(database(), id, { status: 'paused', error: null })
    },
    resume(id) {
      pausedIds.delete(id)
      return enqueue(() => reindex(id, 'resume'))
    },
    limits: () => readIndexLimits(database()),
    setLimits: (patch) => writeIndexLimits(database(), patch),
    async answerQuestion(question, messageId) {
      try {
        const ask = classifyFileAsk(question)
        if (!ask) return { kind: 'skip' }
        const grants = listGrants(database())
        const plan = planAccess(ask, grants, suggestionRows(false), deps.home, style)
        if (plan.action === 'refuse') {
          return { kind: 'answer', engine: 'index', answer: { text: plan.text, citations: [], gate: 'insufficient' } }
        }
        if (plan.action === 'ask') {
          return {
            kind: 'ask',
            prompt: { id: messageId, messageId, label: plan.label, path: plan.path, question: plan.text, specific: plan.specific, note: plan.note },
          }
        }
        return { kind: 'answer', engine: 'index', answer: await searchGranted(ask, plan.roots) }
      } finally {
        void enqueue(() => upgradeHashGrants()).catch(() => undefined)
      }
    },
    upgradeEmbeddings() {
      return enqueue(() => upgradeHashGrants())
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

  void enqueue(() => upgradeHashGrants()).catch(() => undefined)

  async function searchGranted(ask: FileAsk, roots: string[]): Promise<FileAnswer> {
    const rows = listGrants(database()).filter((row) => roots.includes(row.path))
    const hits = await searchGroups(ask.query, rows)
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
      if (names.hits.length) return composeNameAnswer(names.hits, deps.home, style)
    }
    return answer
  }

  async function searchGroups(query: string, rows: GrantRow[]): Promise<RankedChunk[]> {
    const hashRows = rows.filter((row) => row.embedder !== 'gemma')
    const gemmaRows = rows.filter((row) => row.embedder === 'gemma')
    const hits: RankedChunk[] = []
    if (hashRows.length) {
      const [qvec] = await hashEmbedder().embedQueries([query])
      hits.push(...searchChunks(database(), query, qvec, hashRows.map((row) => row.id), 5))
    }
    if (gemmaRows.length) {
      const gemma = deps.tryGemma ? await deps.tryGemma().catch(() => null) : null
      const qvec = gemma ? (await gemma.embedQueries([query]))[0] ?? null : null
      hits.push(...searchChunks(database(), query, qvec, gemmaRows.map((row) => row.id), 5))
    }
    hits.sort((a, b) => b.rrf - a.rrf || b.cosine - a.cosine)
    return hits.slice(0, 5)
  }

  async function upgradeHashGrants(): Promise<void> {
    if (closed) return
    const pending = listGrants(database()).filter((row) => row.embedder !== 'gemma' && row.status !== 'idle' && row.status !== 'paused' && !pausedIds.has(row.id))
    if (!pending.length) return
    const gemma = deps.tryGemma ? await deps.tryGemma().catch(() => null) : null
    if (!gemma) return
    for (const row of pending) {
      if (closed) return
      await reembedGrant(row, gemma)
    }
  }

  async function reembedGrant(row: GrantRow, gemma: CodeEmbedder): Promise<void> {
    const current = getGrant(database(), row.id)
    if (!current || current.embedder === 'gemma') return
    const pieces = chunksForGrant(database(), current.id)
    clearStage(database(), current.id)
    if (!pieces.length) {
      updateGrantProgress(database(), current.id, { embedder: 'gemma', status: 'ready', error: null })
      return
    }
    const files = new Map<number, typeof pieces>()
    for (const piece of pieces) {
      const group = files.get(piece.fileId) ?? []
      group.push(piece)
      files.set(piece.fileId, group)
    }
    const groups = [...files.values()]
    const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
    updateGrantProgress(database(), current.id, { status: 'indexing', error: null })
    deps.onProgress?.({ grantId: current.id, path: current.path, done: 0, total: groups.length, byteSize: current.byteSize, status: 'indexing', error: null, phase: 'embed' })
    try {
      let done = 0
      for (const group of groups) {
        const vectors = await gemma.embedDocs(group.map((piece) => ({ title: piece.name, text: piece.text })))
        group.forEach((piece, index) => {
          const vector = vectors[index]
          if (!vector) throw new Error('missing embedding')
          stageEmbedding(database(), current.id, piece.id, vector)
        })
        done += 1
        deps.onProgress?.({ grantId: current.id, path: current.path, done, total: groups.length, byteSize: current.byteSize, status: 'indexing', error: null, phase: 'embed' })
        if (done < groups.length) await sleep(INDEX_GAP_MS)
      }
      commitStagedEmbeddings(database(), current.id)
      deps.onProgress?.({ grantId: current.id, path: current.path, done: groups.length, total: groups.length, byteSize: current.byteSize, status: 'ready', error: null, phase: 'embed' })
      console.info(`[surf] file embed upgrade files=${groups.length}`)
    } catch {
      clearStage(database(), current.id)
      updateGrantProgress(database(), current.id, { status: 'ready', error: null })
      deps.onProgress?.({ grantId: current.id, path: current.path, done: 0, total: groups.length, byteSize: current.byteSize, status: 'ready', error: null, phase: 'embed' })
    }
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
