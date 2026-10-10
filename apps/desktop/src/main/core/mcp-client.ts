/**
 * Minimal MCP client: JSON-RPC over stdio (Content-Length frames) and HTTP.
 * HTTP hosts must be on the allow list. Write tools wait for the approval gate.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { ApprovalGate, type ProposedAction } from './approval-policy.js'
import { mcpAllowed } from './code-tools.js'

export interface McpTool {
  name: string
  description: string
  write: boolean
}

interface Rpc {
  jsonrpc: '2.0'
  id?: number
  method?: string
  result?: unknown
  error?: { message?: string }
  params?: unknown
}

function frame(message: unknown): string {
  const body = JSON.stringify(message)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

export class McpStdio {
  private proc: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private waiters = new Map<number, (message: Rpc) => void>()
  private next = 1
  tools: McpTool[] = []

  static async connect(command: string, args: string[]): Promise<McpStdio> {
    const client = new McpStdio()
    client.proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    client.proc.stdout.on('data', (chunk: Buffer) => client.onData(chunk.toString('utf8')))
    await client.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'surf', version: '0.1.0' } })
    client.notify('notifications/initialized', {})
    const listed = await client.request('tools/list', {})
    const tools = (listed.result as { tools?: { name: string; description?: string; annotations?: { readOnlyHint?: boolean } }[] })?.tools ?? []
    client.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      write: tool.annotations?.readOnlyHint !== true,
    }))
    return client
  }

  private onData(text: string): void {
    this.buffer += text
    while (true) {
      const header = this.buffer.match(/Content-Length: (\d+)\r\n\r\n/)
      if (!header || header.index == null) return
      const start = header.index + header[0].length
      const length = Number(header[1])
      if (Buffer.byteLength(this.buffer.slice(start)) < length) return
      const body = Buffer.from(this.buffer.slice(start)).subarray(0, length).toString('utf8')
      this.buffer = Buffer.from(this.buffer.slice(start)).subarray(length).toString('utf8')
      const message = JSON.parse(body) as Rpc
      if (message.id != null) this.waiters.get(message.id)?.(message)
    }
  }

  private notify(method: string, params: unknown): void {
    this.proc?.stdin.write(frame({ jsonrpc: '2.0', method, params }))
  }

  private request(method: string, params: unknown): Promise<Rpc> {
    const id = this.next++
    const proc = this.proc
    if (!proc) return Promise.reject(new Error('MCP process is not running.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 8000)
      this.waiters.set(id, (message) => {
        clearTimeout(timer)
        this.waiters.delete(id)
        resolve(message)
      })
      proc.stdin.write(frame({ jsonrpc: '2.0', id, method, params }))
    })
  }

  async call(name: string, args: Record<string, unknown>, gate: ApprovalGate, now: number): Promise<{ applied: boolean; state: string; text: string }> {
    const tool = this.tools.find((item) => item.name === name)
    if (!tool) return { applied: false, state: 'missing', text: '' }
    if (tool.write) {
      const action: ProposedAction = { id: `mcp-${name}`, connector: 'mcp', class: 'write', verb: 'modify', summary: name }
      if (!gate.has(action.id)) {
        const decision = gate.submit(action, now)
        if (decision.state !== 'done') return { applied: false, state: decision.state, text: '' }
      } else {
        const decision = gate.approve(action.id, now)
        if (decision.state !== 'done') return { applied: false, state: decision.state, text: '' }
      }
    }
    const message = await this.request('tools/call', { name, arguments: args })
    const text = JSON.stringify(message.result ?? message.error ?? {})
    return { applied: true, state: 'done', text }
  }

  close(): void {
    this.proc?.kill()
  }
}

export async function mcpHttp(url: string, allow: string[], method: string, params: unknown, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (!mcpAllowed(url, allow)) throw new Error('That MCP host is not on the allow list.')
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`MCP HTTP failed (${res.status}).`)
  return res.json()
}
