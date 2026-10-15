/**
 * Project search for the Code agent.
 *
 * CodeIndex.context(task, { tokenBudget }) already returns this shape.
 * adaptCodeIndex is a direct call, with no field mapping.
 * projectSearchFor uses that adapter when a project is indexed, and the
 * ripgrep stub otherwise. This file does not import the index.
 */
import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { resolveInside } from './paths.js'

export interface ProjectSnippet {
  path: string
  startLine: number
  endLine: number
  symbol: string | null
  kind: string
  text: string
  reason: 'search' | 'definition' | 'related'
  score: number
}

export interface ProjectContext {
  snippets: ProjectSnippet[]
  files: string[]
  tokens: number
  dropped: number
}

/** Same fields CodeIndex.context reads. Extra fields are optional so the stub can ignore them. */
export interface ProjectSearchOptions {
  tokenBudget: number
  maxSnippets?: number
  embedder?: unknown
  counter?: unknown
}

export interface ProjectSearch {
  context(task: string, options: ProjectSearchOptions): Promise<ProjectContext>
}

/** Direct plug-in. codeIndex.context already returns ProjectContext. */
export function adaptCodeIndex(index: {
  context(task: string, options: { tokenBudget: number }): Promise<ProjectContext>
}): ProjectSearch {
  return {
    context: (task, options) => index.context(task, { tokenBudget: options.tokenBudget }),
  }
}

/** Indexed projects use CodeIndex. A folder with no ready index uses the ripgrep stub. */
export function projectSearchFor(
  root: string,
  index: { context(task: string, options: { tokenBudget: number }): Promise<ProjectContext> } | null,
): ProjectSearch {
  return index ? adaptCodeIndex(index) : createProjectSearch(root)
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', 'target', 'vendor'])
const SKIP_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'zip', 'gz', 'wasm', 'exe', 'dll', 'so', 'dylib', 'bin', 'ico', 'icns', 'woff', 'woff2', 'ttf', 'mp3', 'mp4', 'lock'])
const MAX_FILES = 1500
const MAX_FILE_BYTES = 128 * 1024
const WINDOW = 6

export interface ProjectSearchStubOptions {
  /** substring skips ripgrep. auto tries ripgrep, then the walk. */
  runner?: 'auto' | 'substring'
}

export function createProjectSearch(root: string, options: ProjectSearchStubOptions = {}): ProjectSearch {
  return {
    async context(task, opts) {
      const query = task.trim()
      const hits = query
        ? await collect(root, query, options.runner ?? 'auto')
        : []
      return packHits(hits, Math.max(0, opts.tokenBudget), opts.maxSnippets ?? 8)
    },
  }
}

interface RawHit {
  path: string
  startLine: number
  endLine: number
  text: string
  score: number
  kind: string
}

async function collect(root: string, query: string, runner: 'auto' | 'substring'): Promise<RawHit[]> {
  if (runner === 'auto') {
    const fromRg = await rgSearch(root, query)
    if (fromRg) return fromRg
  }
  return substringSearch(root, query)
}

function packHits(hits: RawHit[], tokenBudget: number, maxSnippets: number): ProjectContext {
  const ordered = [...hits].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const snippets: ProjectSnippet[] = []
  let tokens = 0
  let dropped = 0
  for (const hit of ordered) {
    if (snippets.length >= maxSnippets) { dropped++; continue }
    const cost = Math.ceil(hit.text.length / 3.2)
    if (tokens + cost > tokenBudget) { dropped++; continue }
    snippets.push({
      path: hit.path,
      startLine: hit.startLine,
      endLine: hit.endLine,
      symbol: null,
      kind: hit.kind,
      text: hit.text,
      reason: 'search',
      score: hit.score,
    })
    tokens += cost
  }
  return {
    snippets,
    files: [...new Set(snippets.map((snippet) => snippet.path))],
    tokens,
    dropped,
  }
}

async function rgSearch(root: string, query: string): Promise<RawHit[] | null> {
  const output = await new Promise<string | null>((resolve) => {
    const child = spawn('rg', [
      '-n', '--no-heading', '-F', '-S',
      '--max-columns', '300',
      '--max-count', '20',
      '--glob', '!node_modules/**',
      '--glob', '!.git/**',
      '--glob', '!dist/**',
      '--glob', '!out/**',
      query,
      '.',
    ], { cwd: root, shell: false })
    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => { if (out.length < 200_000) out += chunk.toString('utf8') })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) resolve(null)
      else resolve(out)
    })
  })
  if (output == null) return null
  const grouped = new Map<string, number[]>()
  for (const line of output.split('\n')) {
    if (!line) continue
    const match = /^(.+?):(\d+):/.exec(line)
    if (!match) continue
    const rel = match[1].replace(/\\/g, '/').replace(/^\.\//, '')
    const row = Number(match[2])
    const rows = grouped.get(rel) ?? []
    rows.push(row)
    grouped.set(rel, rows)
  }
  const hits: RawHit[] = []
  for (const [rel, rows] of grouped) {
    const snippet = await windowAt(root, rel, rows)
    if (snippet) hits.push(snippet)
  }
  return hits
}

async function substringSearch(root: string, query: string): Promise<RawHit[]> {
  const needle = query.toLowerCase()
  const files: string[] = []
  await walk(root, root, files)
  const hits: RawHit[] = []
  for (const rel of files) {
    const abs = resolveInside(root, rel)
    if (!abs) continue
    let text = ''
    try { text = await readFile(abs, 'utf8') } catch { continue }
    if (text.includes('\u0000')) continue
    if (!text.toLowerCase().includes(needle)) continue
    const lines = text.split(/\r?\n/)
    const rows: number[] = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) rows.push(i + 1)
      if (rows.length >= 20) break
    }
    const snippet = snippetFrom(rel, lines, rows)
    if (snippet) hits.push(snippet)
  }
  return hits
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await walk(root, join(dir, entry.name), out)
      continue
    }
    if (!entry.isFile()) continue
    const ext = entry.name.includes('.') ? entry.name.split('.').pop()?.toLowerCase() ?? '' : ''
    if (SKIP_EXT.has(ext)) continue
    const abs = join(dir, entry.name)
    const rel = relative(root, abs).split(sep).join('/')
    if (!rel || rel.split('/').includes('..')) continue
    try {
      const info = await stat(abs)
      if (info.size > MAX_FILE_BYTES) continue
    } catch { continue }
    out.push(rel)
  }
}

async function windowAt(root: string, rel: string, rows: number[]): Promise<RawHit | null> {
  const abs = resolveInside(root, rel)
  if (!abs) return null
  let text = ''
  try { text = await readFile(abs, 'utf8') } catch { return null }
  if (text.includes('\u0000') || text.length > MAX_FILE_BYTES) return null
  return snippetFrom(rel, text.split(/\r?\n/), rows)
}

function snippetFrom(rel: string, lines: string[], rows: number[]): RawHit | null {
  if (!rows.length) return null
  const first = rows[0] ?? 1
  const start = Math.max(1, first - WINDOW)
  const end = Math.min(lines.length, first + WINDOW)
  const text = lines.slice(start - 1, end).join('\n')
  const ext = rel.includes('.') ? rel.split('.').pop()?.toLowerCase() ?? 'text' : 'text'
  return { path: rel, startLine: start, endLine: end, text, score: rows.length, kind: ext }
}
