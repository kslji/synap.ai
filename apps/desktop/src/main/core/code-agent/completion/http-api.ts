/**
 * Loopback HTTP API for a future editor extension. The renderer uses IPC instead.
 * Bind is 127.0.0.1 only, with a random bearer token. No other host is accepted.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'

const MAX_BODY = 600_000

export class HttpStatus extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpStatus'
  }
}

export interface CompletionEndpoint {
  port: number
  token: string
  close(): Promise<void>
}

export async function startCompletionHttp(
  handle: (body: unknown, signal: AbortSignal) => Promise<unknown>,
): Promise<CompletionEndpoint> {
  const token = randomBytes(24).toString('base64url')
  const server = createServer((req, res) => {
    void onRequest(req, res, token, handle).catch((error: unknown) => {
      if (error instanceof HttpStatus) sendJson(res, error.status, { error: error.message })
      else sendJson(res, 500, { error: 'completion failed' })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    port,
    token,
    close: () => closeServer(server),
  }
}

async function onRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  handle: (body: unknown, signal: AbortSignal) => Promise<unknown>,
): Promise<void> {
  if (!loopback(req.socket.remoteAddress)) {
    sendJson(res, 403, { error: 'loopback only' })
    return
  }
  if (!authorized(req.headers.authorization, token)) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }
  if (req.method === 'GET' && req.url?.split('?')[0] === '/v1/health') {
    sendJson(res, 200, { ok: true })
    return
  }
  if (req.method !== 'POST' || req.url?.split('?')[0] !== '/v1/complete') {
    sendJson(res, 404, { error: 'not found' })
    return
  }
  const raw = await readBody(req)
  let body: unknown
  try { body = JSON.parse(raw) } catch {
    sendJson(res, 400, { error: 'invalid json' })
    return
  }
  const controller = new AbortController()
  req.on('close', () => { if (!res.writableEnded) controller.abort() })
  const result = await handle(body, controller.signal)
  sendJson(res, 200, result)
}

function authorized(header: string | undefined, token: string): boolean {
  return header === `Bearer ${token}`
}

function loopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::ffff:127.0.0.1' || address === '::1'
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}
