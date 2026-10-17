/**
 * Filename search.
 * macOS uses Spotlight (`mdfind`). Windows uses the Windows Search index through
 * OLE DB (SystemIndex) from PowerShell, because Node has no OLE DB binding.
 * Both are injected so CI never shells out. A walker covers Linux and a missing index.
 * Every hit is still checked against the grant and the exclusion list.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { canReadPath } from './permissions.js'
import { baseName, isInsideRoot, type PathStyle } from './paths.js'

export interface NameHit {
  path: string
  name: string
  size: number | null
  mtimeMs: number | null
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<CommandResult>

export type NameEngine = 'spotlight' | 'windows' | 'walker'

const QUERY_MAX = 80

export function sanitizeQuery(query: string): string {
  return query.replace(/[^0-9A-Za-z ._-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX)
}

export function spotlightInvocation(query: string, root: string): { command: string; args: string[] } {
  const safe = sanitizeQuery(query).replace(/"/g, '')
  const pred = `kMDItemFSName == "*${safe}*"c || kMDItemDisplayName == "*${safe}*"c`
  return { command: 'mdfind', args: ['-onlyin', root, pred] }
}

export function parseMdfind(stdout: string): NameHit[] {
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((path) => ({
    path,
    name: baseName(path),
    size: null,
    mtimeMs: null,
  }))
}

/** PowerShell + System.Data.OleDb against the Windows Search catalog. */
export function windowsSearchScript(query: string, roots: readonly string[]): string {
  const like = sanitizeQuery(query).replace(/'/g, "''")
  const scopes = roots.map((root) => {
    const win = root.replace(/\//g, '\\').replace(/'/g, "''").replace(/[\r\n]/g, '')
    return `SCOPE = 'file:${win}'`
  }).join(' OR ')
  return [
    "$ErrorActionPreference = 'Stop'",
    "$conn = New-Object System.Data.OleDb.OleDbConnection 'Provider=Search.CollatorDSO;Extended Properties=\"Application=Windows\"'",
    '$conn.Open()',
    '$cmd = $conn.CreateCommand()',
    `$cmd.CommandText = "SELECT System.ItemPathDisplay, System.FileName, System.Size, System.DateModified FROM SystemIndex WHERE (${scopes}) AND (System.FileName LIKE '%${like}%' OR CONTAINS('${like}'))"`,
    '$adapter = New-Object System.Data.OleDb.OleDbDataAdapter $cmd',
    '$table = New-Object System.Data.DataTable',
    '[void]$adapter.Fill($table)',
    '$conn.Close()',
    'foreach ($row in $table.Rows) {',
    "  $obj = [ordered]@{ path = [string]$row['System.ItemPathDisplay']; name = [string]$row['System.FileName']; size = 0; mtimeMs = 0 }",
    '  if ($row[\'System.Size\'] -is [long] -or $row[\'System.Size\'] -is [int]) { $obj.size = [int64]$row[\'System.Size\'] }',
    '  Write-Output ($obj | ConvertTo-Json -Compress)',
    '}',
  ].join('\n')
}

export function windowsSearchInvocation(script: string): { command: string; args: string[] } {
  return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] }
}

export function parseWindowsSearch(stdout: string): NameHit[] {
  const hits: NameHit[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    try {
      const row = JSON.parse(trimmed) as { path?: string; name?: string; size?: number; mtimeMs?: number }
      if (!row.path) continue
      hits.push({
        path: row.path,
        name: row.name || baseName(row.path),
        size: typeof row.size === 'number' ? row.size : null,
        mtimeMs: typeof row.mtimeMs === 'number' ? row.mtimeMs : null,
      })
    } catch {
      /* a non-JSON line from the host is ignored */
    }
  }
  return hits
}

export interface WalkFns {
  readdir: (dir: string) => string[]
  stat: (file: string) => { isDirectory: () => boolean; isFile: () => boolean; size: number; mtimeMs: number }
}

export function walkNames(query: string, roots: readonly string[], style: PathStyle, fns: WalkFns = { readdir: readdirSync, stat: statSync }, maxFiles = 20000): NameHit[] {
  const needle = sanitizeQuery(query).toLowerCase()
  const hits: NameHit[] = []
  let seen = 0
  const visit = (dir: string, depth: number) => {
    if (depth > 12 || seen >= maxFiles) return
    let names: string[] = []
    try { names = fns.readdir(dir) } catch { return }
    for (const name of names) {
      if (seen >= maxFiles) return
      const full = join(dir, name)
      if (!canReadPath(full, roots, style)) continue
      let info: ReturnType<WalkFns['stat']>
      try { info = fns.stat(full) } catch { continue }
      if (info.isDirectory()) {
        visit(full, depth + 1)
        continue
      }
      if (!info.isFile()) continue
      seen += 1
      if (!needle || name.toLowerCase().includes(needle) || needle.split(' ').every((part) => part.length < 3 || name.toLowerCase().includes(part))) {
        hits.push({ path: full, name, size: info.size, mtimeMs: info.mtimeMs })
      }
    }
  }
  for (const root of roots) visit(root, 0)
  return hits
}

export function keepGranted(hits: readonly NameHit[], roots: readonly string[], style: PathStyle): NameHit[] {
  return hits.filter((hit) => roots.some((root) => isInsideRoot(root, hit.path, style)) && canReadPath(hit.path, roots, style))
}

export async function searchFileNames(opts: {
  query: string
  roots: readonly string[]
  style: PathStyle
  platform: string
  spotlight: boolean
  windowsSearch: boolean
  run: CommandRunner
  walk?: WalkFns
}): Promise<{ engine: NameEngine; hits: NameHit[] }> {
  const roots = opts.roots.filter(Boolean)
  if (!roots.length) return { engine: 'walker', hits: [] }
  if (opts.platform === 'darwin' && opts.spotlight) {
    const found: NameHit[] = []
    let ok = true
    for (const root of roots) {
      const call = spotlightInvocation(opts.query, root)
      try {
        const result = await opts.run(call.command, call.args, 8000)
        if (result.code !== 0) { ok = false; break }
        found.push(...parseMdfind(result.stdout))
      } catch {
        ok = false
        break
      }
    }
    if (ok) return { engine: 'spotlight', hits: keepGranted(found, roots, opts.style) }
  }
  if (opts.platform === 'win32' && opts.windowsSearch) {
    const script = windowsSearchScript(opts.query, roots)
    const call = windowsSearchInvocation(script)
    try {
      const result = await opts.run(call.command, call.args, 8000)
      if (result.code === 0) return { engine: 'windows', hits: keepGranted(parseWindowsSearch(result.stdout), roots, opts.style) }
    } catch {
      /* walker below */
    }
  }
  return { engine: 'walker', hits: walkNames(opts.query, roots, opts.style, opts.walk) }
}
