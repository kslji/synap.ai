/**
 * Optional language-server references.
 * pyright-langserver and typescript-language-server are used when they are on PATH.
 * Any miss, timeout, or protocol error falls back to the tree-sitter graph.
 */
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface LspLocation { path: string; line: number }

export interface LspServers { pyright: string | null; typescript: string | null }

const SERVERS: { key: keyof LspServers; names: string[] }[] = [
  { key: 'pyright', names: ['pyright-langserver'] },
  { key: 'typescript', names: ['typescript-language-server'] },
]

export async function findOnPath(names: string[], env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch { /* next */ }
    }
  }
  return null
}

export async function detectLanguageServers(env: NodeJS.ProcessEnv = process.env): Promise<LspServers> {
  const out: LspServers = { pyright: null, typescript: null }
  for (const server of SERVERS) out[server.key] = await findOnPath(server.names, env)
  return out
}

export function serverForLanguage(language: string, servers: LspServers): { command: string; args: string[] } | null {
  if (language === 'python' && servers.pyright) return { command: servers.pyright, args: ['--stdio'] }
  if ((language === 'typescript' || language === 'tsx' || language === 'javascript') && servers.typescript) {
    return { command: servers.typescript, args: ['--stdio'] }
  }
  return null
}

interface RpcMessage { jsonrpc?: string; id?: number; method?: string; result?: unknown; error?: unknown }

function encode(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body])
}

function takeMessage(buffer: Buffer): { message: RpcMessage; rest: Buffer } | null {
  const headerEnd = buffer.indexOf('\r\n\r\n')
  if (headerEnd < 0) return null
  const header = buffer.subarray(0, headerEnd).toString('utf8')
  const match = /Content-Length:\s*(\d+)/i.exec(header)
  if (!match) return null
  const length = Number(match[1])
  const start = headerEnd + 4
  if (buffer.length < start + length) return null
  const message = JSON.parse(buffer.subarray(start, start + length).toString('utf8')) as RpcMessage
  return { message, rest: buffer.subarray(start + length) }
}

export async function lspReferences(options: {
  command: string
  args?: string[]
  root: string
  file: string
  languageId: string
  line: number
  character: number
  timeoutMs?: number
}): Promise<LspLocation[] | null> {
  const timeoutMs = options.timeoutMs ?? 2500
  let child
  try {
    child = spawn(options.command, options.args ?? [], { stdio: ['pipe', 'pipe', 'ignore'] })
  } catch {
    return null
  }
  const fileUri = pathToFileURL(options.file).href
  const rootUri = pathToFileURL(options.root).href
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  const pending = new Map<number, (message: RpcMessage) => void>()
  let failed = false

  const result = new Promise<LspLocation[] | null>((resolve) => {
    const timer = setTimeout(() => { failed = true; resolve(null) }, timeoutMs)
    const finish = (value: LspLocation[] | null) => { clearTimeout(timer); resolve(value) }
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      for (;;) {
        const next = takeMessage(buffer)
        if (!next) break
        buffer = next.rest
        if (typeof next.message.id === 'number') pending.get(next.message.id)?.(next.message)
      }
    })
    child.on('error', () => finish(null))
    child.on('exit', () => { if (!failed) finish(null) })

    const send = (message: unknown) => { child.stdin?.write(encode(message)) }
    const request = (id: number, method: string, params: unknown) => new Promise<RpcMessage>((resolveMessage, reject) => {
      pending.set(id, resolveMessage)
      send({ jsonrpc: '2.0', id, method, params })
      setTimeout(() => reject(new Error('lsp timeout')), timeoutMs)
    })

    void (async () => {
      try {
        const text = await readFile(options.file, 'utf8')
        await request(1, 'initialize', {
          processId: process.pid,
          rootUri,
          capabilities: { textDocument: { references: { dynamicRegistration: false } } },
          workspaceFolders: [{ uri: rootUri, name: 'project' }],
        })
        send({ jsonrpc: '2.0', method: 'initialized', params: {} })
        send({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: { textDocument: { uri: fileUri, languageId: options.languageId, version: 1, text } },
        })
        const response = await request(2, 'textDocument/references', {
          textDocument: { uri: fileUri },
          position: { line: options.line, character: options.character },
          context: { includeDeclaration: true },
        })
        if (response.error || !Array.isArray(response.result)) { finish(null); return }
        const locations: LspLocation[] = []
        for (const item of response.result) {
          const loc = item as { uri?: string; range?: { start?: { line?: number } } }
          if (!loc.uri || loc.range?.start?.line == null) continue
          const path = loc.uri.startsWith('file:') ? fileURLToPath(loc.uri) : loc.uri
          locations.push({ path, line: loc.range.start.line + 1 })
        }
        finish(locations)
      } catch {
        finish(null)
      }
    })()
  })

  try {
    const locations = await result
    try { child.stdin?.write(encode({ jsonrpc: '2.0', id: 3, method: 'shutdown', params: null })) } catch { /* exiting */ }
    try { child.stdin?.write(encode({ jsonrpc: '2.0', method: 'exit', params: {} })) } catch { /* exiting */ }
    return locations
  } finally {
    setTimeout(() => { if (!child.killed) child.kill() }, 200)
  }
}

export async function referencesWithFallback(graph: () => { path: string; line: number }[], lsp: (() => Promise<LspLocation[] | null>) | null): Promise<{ source: 'lsp' | 'graph'; items: { path: string; line: number }[] }> {
  if (lsp) {
    try {
      const exact = await lsp()
      if (exact && exact.length) return { source: 'lsp', items: exact }
    } catch { /* graph */ }
  }
  return { source: 'graph', items: graph() }
}
