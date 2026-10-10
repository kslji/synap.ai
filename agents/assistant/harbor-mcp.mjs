/**
 * Example open connector. Read is a note lookup. Write changes the note and
 * must be approved by Surf before this process is asked to apply it.
 * Speaks MCP JSON-RPC on stdio, or HTTP when started with --http PORT.
 */
import { createServer } from 'node:http'

let note = 'Pier 4 is open.'

const tools = [
  {
    name: 'harbor.note.read',
    description: 'Read the local harbor note.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'harbor.note.write',
    description: 'Replace the local harbor note.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: false },
  },
]

function handle(message) {
  if (message.method === 'initialize') {
    return { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'harbor-notes', version: '0.1.0' } }
  }
  if (message.method === 'tools/list') return { tools }
  if (message.method === 'tools/call') {
    const name = message.params?.name
    const args = message.params?.arguments ?? {}
    if (name === 'harbor.note.read') return { content: [{ type: 'text', text: note }] }
    if (name === 'harbor.note.write') {
      note = String(args.text ?? '')
      return { content: [{ type: 'text', text: note }] }
    }
    return { isError: true, content: [{ type: 'text', text: 'unknown tool' }] }
  }
  return {}
}

function reply(message) {
  if (message.id == null) return null
  return { jsonrpc: '2.0', id: message.id, result: handle(message) }
}

function serveStdio() {
  let buffer = ''
  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    while (true) {
      const header = buffer.match(/Content-Length: (\d+)\r\n\r\n/)
      if (!header || header.index == null) return
      const start = header.index + header[0].length
      const length = Number(header[1])
      if (Buffer.byteLength(buffer.slice(start)) < length) return
      const body = Buffer.from(buffer.slice(start)).subarray(0, length).toString('utf8')
      buffer = Buffer.from(buffer.slice(start)).subarray(length).toString('utf8')
      const message = JSON.parse(body)
      const response = reply(message)
      if (!response) continue
      const text = JSON.stringify(response)
      process.stdout.write(`Content-Length: ${Buffer.byteLength(text)}\r\n\r\n${text}`)
    }
  })
}

const httpIndex = process.argv.indexOf('--http')
if (httpIndex >= 0) {
  const port = Number(process.argv[httpIndex + 1] ?? 0)
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    const response = reply(message) ?? { jsonrpc: '2.0', result: {} }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(response))
  })
  server.listen(port, '127.0.0.1')
} else {
  serveStdio()
}
