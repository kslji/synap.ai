/**
 * Local project index for the Code agent.
 *
 * Step 3 calls `buildContext(task, { tokenBudget })` and receives snippets plus file paths.
 * Graph queries (`definition`, `references`, `related`, `impact`) answer "where is X"
 * and "what may break if I change X" without sending the whole tree to the model.
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import type { CodeProjectStatus } from '../ipc-contract.js'
import { chunksFor } from './chunks.js'
import { buildContext, type ContextOptions, type ContextPack } from './context.js'
import { EMBEDDING_DIM } from './embed-dim.js'
import type { CodeEmbedder } from './embed.js'
import { CODE_LIMITS } from './limits.js'
import { detectLanguageServers, lspReferences, referencesWithFallback, serverForLanguage } from './lsp.js'
import { parseSource } from './parse.js'
import { classifyFile, scanProject, type ScannedFile } from './scan.js'
import { searchCode, type CodeHit } from './search.js'
import {
  counts, definitions, deletePath, impactOf, importedDefinitions, linkEdges, listFiles, markEmbedded, nearbyDefinitions, openCodeDb, readPlanFacts,
  pendingChunks, referencesTo, relatedFiles, writeFileIndex,
  type CodeDb, type ImpactHit, type RefHit, type RelatedHit, type SymbolHit,
} from './store.js'
import { watchProject } from './watch.js'
import { BackgroundIndex } from '../live/index-queue.js'

export type { CodeProjectStatus }

export function projectIdFor(root: string): string {
  return createHash('sha256').update(realpathSync(resolve(root))).digest('hex').slice(0, 16)
}

export function dbFileBytes(path: string): number {
  let total = 0
  for (const suffix of ['', '-wal', '-shm']) {
    try { total += statSync(path + suffix).size } catch { /* not created yet */ }
  }
  return total
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function insideRoot(root: string, rel: string): string | null {
  const posix = rel.split(sep).join('/').replace(/^\.\//, '')
  if (!posix || posix.startsWith('..') || posix.split('/').includes('..')) return null
  const abs = resolve(root, posix)
  const back = relative(root, abs)
  if (!back || back.startsWith('..') || back.split(sep).includes('..')) return null
  return posix
}

export class CodeIndex {
  private db: CodeDb
  private chain: Promise<void> = Promise.resolve()
  private watcher: { close(): void } | null = null
  private state: CodeProjectStatus['state'] = 'idle'
  private done = 0
  private planned = 0
  private error: string | null = null
  private embedder: CodeEmbedder | null
  private closed = false
  private bg!: BackgroundIndex
  readonly id: string
  readonly root: string
  readonly dbPath: string
  readonly encrypted: boolean

  constructor(opts: {
    root: string
    dbPath: string
    keyHex: string | null
    grammarDir: string
    embedder?: CodeEmbedder | null
    onProgress?: (status: CodeProjectStatus) => void
  }) {
    this.root = realpathSync(resolve(opts.root))
    this.dbPath = opts.dbPath
    this.encrypted = Boolean(opts.keyHex)
    this.embedder = opts.embedder ?? null
    this.grammarDir = opts.grammarDir
    this.onProgress = opts.onProgress
    this.id = projectIdFor(this.root)
    this.db = openCodeDb(opts.dbPath, opts.keyHex)
    this.bg = new BackgroundIndex(
      async (rel) => {
        if (this.closed) return
        await this.exclusive(() => this.indexPaths([rel]))
      },
      () => { void this.embedPending() },
      (error) => this.fail(error),
    )
  }

  private readonly grammarDir: string
  private readonly onProgress?: (status: CodeProjectStatus) => void

  setEmbedder(embedder: CodeEmbedder | null): void {
    this.embedder = embedder
  }

  status(): CodeProjectStatus {
    const tally = counts(this.db)
    let embeddings: CodeProjectStatus['embeddings'] = 'off'
    if (tally.chunks > 0 && tally.embedded === tally.chunks) embeddings = 'ready'
    else if (tally.embedded > 0 || (this.embedder && tally.chunks > tally.embedded)) embeddings = 'pending'
    const indexing = this.state === 'indexing'
    return {
      id: this.id,
      root: this.root,
      state: this.state,
      files: indexing && this.planned > 0 ? this.planned : tally.files,
      done: indexing ? this.done : tally.files,
      symbols: tally.symbols,
      bytes: dbFileBytes(this.dbPath),
      embeddings,
      encrypted: this.encrypted,
      error: this.error,
    }
  }

  /** Index the tree. Keyword rows land first; embeddings follow in small batches. */
  async run(): Promise<CodeProjectStatus> {
    await this.indexAll()
    await this.embedPending()
    return this.status()
  }

  async update(rels: string[]): Promise<void> {
    await this.exclusive(() => this.indexPaths(rels))
    await this.embedPending()
  }

  watch(): void {
    this.watcher?.close()
    this.watcher = watchProject(this.root, (rels) => { this.bg.enqueue(rels) })
  }

  close(): void {
    this.closed = true
    this.watcher?.close()
    this.watcher = null
    void this.exclusive(async () => {
      try { this.db.close() } catch { /* already closed */ }
    })
  }

  search(query: string): Promise<CodeHit[]> {
    return this.read(async () => {
      const qvec = await this.queryVector(query)
      return searchCode(this.db, query, qvec)
    })
  }

  definition(name: string, preferPath?: string): Promise<SymbolHit[]> {
    return this.read(async () => definitions(this.db, name, preferPath))
  }

  references(name: string): Promise<RefHit[]> {
    return this.read(async () => referencesTo(this.db, name))
  }

  related(path: string): Promise<RelatedHit[]> {
    return this.read(async () => relatedFiles(this.db, path))
  }

  /** Callers, references, and imports of a symbol: what may break if it changes. */
  impact(name: string): Promise<ImpactHit[]> {
    return this.read(async () => impactOf(this.db, name))
  }

  /**
   * Exact references from pyright or typescript-language-server when one is on PATH.
   * Otherwise the tree-sitter graph.
   */
  exactReferences(name: string): Promise<{ source: 'lsp' | 'graph'; items: { path: string; line: number }[] }> {
    return this.read(async () => {
      const defs = definitions(this.db, name)
      const graph = () => referencesTo(this.db, name).map((hit) => ({ path: hit.path, line: hit.line }))
      const def = defs[0]
      if (!def) return referencesWithFallback(graph, null)
      const language = listFiles(this.db).find((file) => file.path === def.path)?.language ?? 'plaintext'
      const servers = await detectLanguageServers()
      const spec = serverForLanguage(language, servers)
      if (!spec) return referencesWithFallback(graph, null)
      return referencesWithFallback(graph, () => lspReferences({
        command: spec.command,
        args: spec.args,
        root: this.root,
        file: resolve(this.root, def.path),
        languageId: language === 'tsx' ? 'typescriptreact' : language,
        line: Math.max(0, def.startLine - 1),
        character: 0,
      }))
    })
  }

  context(task: string, options: ContextOptions): Promise<ContextPack> {
    return this.read(async () => buildContext(this.db, task, { ...options, embedder: options.embedder ?? this.embedder }))
  }

  /** Imported symbols and definitions above a cursor line, for inline completion. */
  completionHints(path: string, line: number): Promise<{ imported: SymbolHit[]; nearby: SymbolHit[] }> {
    return this.read(async () => ({
      imported: importedDefinitions(this.db, path, 6),
      nearby: nearbyDefinitions(this.db, path, line, 6),
    }))
  }

  /** Indexed files, symbols, and caller→definition edges. Used to validate a plan. */
  planFacts(): Promise<{ indexed: true; files: string[]; symbols: { name: string; qualified: string; kind: string; path: string }[]; edges: { from: string; to: string; kind: string }[] }> {
    return this.read(async () => ({ indexed: true as const, ...readPlanFacts(this.db) }))
  }

  /** Search and graph reads jump ahead of files that have not been indexed yet. */
  private read<T>(fn: () => Promise<T>): Promise<T> {
    return this.bg.prioritize(() => this.exclusive(fn))
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  private fail(error: unknown): void {
    this.state = 'error'
    this.error = (error as Error).message
    this.emit()
  }

  private emit(): void {
    this.onProgress?.(this.status())
  }

  private async queryVector(query: string): Promise<Float32Array | null> {
    if (!this.embedder) return null
    const [vec] = await this.embedder.embedQueries([query])
    return vec ?? null
  }

  private async indexAll(): Promise<void> {
    const scan = scanProject(this.root)
    let existing = new Map<string, string>()
    await this.exclusive(async () => {
      this.state = 'indexing'
      this.error = null
      existing = new Map(listFiles(this.db).map((file) => [file.path, file.sha256]))
      const seen = new Set(scan.files.map((file) => file.rel))
      for (const path of existing.keys()) if (!seen.has(path)) deletePath(this.db, path)
      this.planned = scan.files.length
      this.done = 0
      this.emit()
    })
    for (const file of scan.files) {
      if (this.closed) return
      await this.exclusive(async () => {
        if (this.closed) return
        const text = readFileSync(file.abs, 'utf8')
        const hash = digest(text)
        this.done++
        if (existing.get(file.rel) === hash) return
        await this.indexText(file, text, hash)
        if (this.done % 8 === 0) this.emit()
      })
      await new Promise((resolveWait) => setImmediate(resolveWait))
    }
    if (this.closed) return
    await this.exclusive(async () => {
      if (this.closed) return
      linkEdges(this.db)
      this.state = 'ready'
      this.emit()
    })
  }

  private async indexPaths(rels: string[]): Promise<void> {
    this.state = 'indexing'
    this.error = null
    const existing = new Map(listFiles(this.db).map((file) => [file.path, file.sha256]))
    for (const rel of rels) {
      const safe = insideRoot(this.root, rel)
      if (!safe) continue
      const abs = resolve(this.root, safe)
      let file: ScannedFile | null = null
      try { file = classifyFile(this.root, abs) } catch { file = null }
      if (!file) {
        deletePath(this.db, safe)
        continue
      }
      const text = readFileSync(file.abs, 'utf8')
      const hash = digest(text)
      if (existing.get(file.rel) === hash) continue
      await this.indexText(file, text, hash)
    }
    if (this.closed) return
    linkEdges(this.db)
    this.state = 'ready'
    this.emit()
  }

  private async indexText(file: ScannedFile, text: string, hash: string): Promise<void> {
    const parsed = await parseSource(file.language, text, this.grammarDir)
    const chunks = chunksFor(parsed.symbols)
    writeFileIndex(this.db, {
      path: file.rel,
      symbols: parsed.symbols,
      edges: parsed.edges,
      chunks,
      vectors: null,
      sha256: hash,
      size: file.size,
      mtimeMs: file.mtimeMs,
      language: parsed.language,
    })
  }

  /** One batch at a time so search can run between embedding calls. */
  private async embedPending(): Promise<void> {
    if (!this.embedder || this.closed) return
    try {
      for (;;) {
        if (this.closed) return
        const done = await this.exclusive(async () => {
          if (this.closed || !this.embedder) return true
          const rows = pendingChunks(this.db, CODE_LIMITS.embedBatch)
          if (!rows.length) return true
          const vecs = await this.embedder.embedDocs(rows.map((row) => ({ title: row.name, text: row.text })))
          if (vecs.length !== rows.length) throw new Error('code embedding batch length mismatch')
          for (const vec of vecs) {
            if (vec.length !== EMBEDDING_DIM) throw new Error(`code embedding dim ${vec.length}, expected ${EMBEDDING_DIM}`)
          }
          markEmbedded(this.db, rows.map((row, index) => ({ id: row.id, vector: vecs[index]! })))
          this.emit()
          return false
        })
        if (done) return
        await new Promise((resolveWait) => setImmediate(resolveWait))
      }
    } catch (error) {
      this.error = (error as Error).message
      this.emit()
    }
  }
}
