/**
 * Folder grant + per-project code index.
 * The open-folder dialog is the one-time permission. A remembered grant reopens without asking again.
 * The renderer cannot pass an arbitrary path.
 */
import { dialog, type BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { CodeEmbedder } from './code/embed.js'
import { CodeIndex, dbFileBytes, projectIdFor, type CodeProjectStatus } from './code/project.js'
import type { CodeStorageUsage } from './ipc-contract.js'

interface Grant {
  id: string
  root: string
  grantedAt: number
}

interface GrantFile {
  current: string | null
  grants: Grant[]
}

export interface CodeApi {
  pick(win: BrowserWindow): Promise<CodeProjectStatus | null>
  status(): Promise<CodeProjectStatus | null>
  storage(): Promise<CodeStorageUsage>
  /** Open folder, including while the first index pass is still running. */
  root(): string | null
  /** The open index after a successful pass. Null until the project is indexed. */
  indexed(): CodeIndex | null
  currentId(): string | null
  shutdown(): void
}

export function createCodeService(opts: {
  dataDir: string
  keyHex: string | null
  grammarDir: string
  embedder: () => Promise<CodeEmbedder | null>
  notify: (status: CodeProjectStatus) => void
}): CodeApi {
  mkdirSync(opts.dataDir, { recursive: true })
  const grantPath = join(opts.dataDir, 'grants.json')
  let grants = readGrants(grantPath)
  let current: CodeIndex | null = null
  let generation = 0

  function save(): void {
    writeFileSync(grantPath, JSON.stringify(grants, null, 2), { mode: 0o600 })
  }

  function remember(id: string, root: string): void {
    grants = {
      current: id,
      grants: [...grants.grants.filter((grant) => grant.id !== id), { id, root, grantedAt: Date.now() }],
    }
    save()
  }

  function kick(index: CodeIndex, gen: number): void {
    const started = Date.now()
    void index.run().then((status) => {
      if (gen !== generation) return
      console.info(`[surf] code index ready id=${status.id} files=${status.files} symbols=${status.symbols} bytes=${status.bytes} embeddings=${status.embeddings} ms=${Date.now() - started}`)
      opts.notify(status)
    }).catch((error: unknown) => {
      console.warn(`[surf] code index failed id=${index.id}: ${(error as Error).message}`)
    })
  }

  async function openRoot(root: string): Promise<CodeProjectStatus> {
    const real = realpathSync(root)
    if (!statSync(real).isDirectory()) throw new Error('Choose a folder.')
    const id = projectIdFor(real)
    if (current && current.id === id) {
      current.setEmbedder(await opts.embedder())
      remember(id, real)
      kick(current, generation)
      return current.status()
    }
    const gen = ++generation
    const previous = current
    current = null
    previous?.close()
    const embedder = await opts.embedder().catch((error: unknown) => {
      console.warn(`[surf] code embeddings unavailable: ${(error as Error).message}`)
      return null
    })
    if (gen !== generation) throw new Error('project open superseded')
    mkdirSync(join(opts.dataDir, id), { recursive: true })
    const index = new CodeIndex({
      root: real,
      dbPath: join(opts.dataDir, id, 'index.sqlite'),
      keyHex: opts.keyHex,
      grammarDir: opts.grammarDir,
      embedder,
      onProgress: (status) => { if (gen === generation) opts.notify(status) },
    })
    current = index
    remember(id, real)
    index.watch()
    kick(index, gen)
    return index.status()
  }

  function restore(): void {
    const grant = grants.grants.find((item) => item.id === grants.current)
    if (!grant || !existsSync(grant.root)) return
    void openRoot(grant.root).catch((error: unknown) => {
      console.warn(`[surf] code index restore failed: ${(error as Error).message}`)
    })
  }

  restore()

  return {
    async pick(win) {
      const picked = await dialog.showOpenDialog(win, {
        title: 'Open a project folder',
        properties: ['openDirectory'],
      })
      const folder = picked.filePaths[0]
      if (picked.canceled || !folder) return current?.status() ?? null
      return openRoot(folder)
    },
    async status() {
      return current?.status() ?? null
    },
    async storage() {
      const projects = grants.grants.map((grant) => ({
        id: grant.id,
        root: grant.root,
        bytes: dbFileBytes(join(opts.dataDir, grant.id, 'index.sqlite')),
      }))
      return {
        totalBytes: projects.reduce((sum, project) => sum + project.bytes, 0),
        projects,
      }
    },
    root() {
      return current?.root ?? null
    },
    indexed() {
      if (!current) return null
      try {
        return current.status().state === 'ready' ? current : null
      } catch {
        return null
      }
    },
    currentId() {
      return current?.id ?? null
    },
    shutdown() {
      generation += 1
      current?.close()
      current = null
    },
  }
}

function readGrants(path: string): GrantFile {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<GrantFile>
    const grants = Array.isArray(parsed.grants) ? parsed.grants.filter(isGrant) : []
    const current = typeof parsed.current === 'string' ? parsed.current : null
    return { current, grants }
  } catch {
    return { current: null, grants: [] }
  }
}

function isGrant(value: unknown): value is Grant {
  if (!value || typeof value !== 'object') return false
  const grant = value as Grant
  return typeof grant.id === 'string' && typeof grant.root === 'string' && typeof grant.grantedAt === 'number' && basename(grant.root).length > 0
}
