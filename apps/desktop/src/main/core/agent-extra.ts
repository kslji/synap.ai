/**
 * Measurements for the connector, invoice, preview, Pyodide, tree-sitter, FIM, and MCP work.
 * Providers are mock HTTP servers. No real account is used.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApprovalGate } from './approval-policy.js'
import { bm25Recall, pickWinner } from './code-retrieval.js'
import { aesCipher } from './connector-crypto.js'
import { ConnectorHub } from './connector-hub.js'
import { devPlaceholder, startMockCloud } from './connector-oauth.js'
import { invoiceDocx, invoicePdf, invoiceXlsx } from './invoice-export.js'
import { draftInvoice } from './invoice.js'
import { docxXml, pdfItems, readSheet } from './document-files.js'
import { fimCanStart, fimComplete } from './fim-complete.js'
import { mcpHttp, McpStdio } from './mcp-client.js'
import { createServer } from 'node:http'
import { freePort } from './sidecar-manager.js'
import { reactPreviewDocument } from '../../shared/react-preview.js'
import { chunkWithTreeSitter } from './syntax-chunk.js'
import { runCode } from './code-tools.js'
import type { Measurement } from './agent-suite.js'

export async function extraMeasures(agentsRoot: string): Promise<Measurement[]> {
  const rows: Measurement[] = []
  rows.push(await treeRow())
  rows.push(await reactRow())
  rows.push(await pythonRow())
  rows.push(await fimRow())
  rows.push(await mcpRow(agentsRoot))
  rows.push(bakeRow(agentsRoot))
  rows.push(...await connectorRows())
  return rows
}

async function treeRow(): Promise<Measurement> {
  const parsed = await chunkWithTreeSitter('src/harbor.ts', 'export function ferryLeave() {\n  return "06:40"\n}\nexport function invoiceTotal() {\n  return 1\n}\n')
  const names = parsed.chunks.map((chunk) => chunk.name)
  return {
    id: 'tree-sitter-chunks',
    suite: 'code',
    weight: 2,
    fields: {
      engine: parsed.engine === 'tree-sitter',
      ferry: names.includes('ferryLeave'),
      invoice: names.includes('invoiceTotal'),
    },
  }
}

async function reactRow(): Promise<Measurement> {
  const doc = reactPreviewDocument('function Harbor(){ return <div className="card"><h1>Harbor booking</h1></div> }')
  return {
    id: 'react-preview',
    suite: 'code',
    weight: 2,
    fields: {
      sandbox: doc.sandbox === 'allow-scripts',
      compiled: doc.srcdoc.includes("h('div'") || doc.srcdoc.includes('h("div"'),
      harbor: doc.srcdoc.includes('Harbor booking'),
      noNetwork: doc.srcdoc.includes("connect-src 'none'"),
    },
  }
}

async function pythonRow(): Promise<Measurement> {
  const printed = await runCode('python', 'print(2 + 2)')
  const loop = await runCode('python', 'while True:\n    pass', 800)
  const net = await runCode('python', 'import urllib.request\nurllib.request.urlopen("http://example.com")')
  return {
    id: 'python-sandbox',
    suite: 'code',
    weight: 3,
    fields: {
      ran: printed.executed === true && printed.result === '4',
      timeout: loop.executed === false && loop.error === 'timed out',
      offline: net.executed === false && (net.error ?? '').includes('network'),
    },
  }
}

async function fimRow(): Promise<Measurement> {
  const blocked = fimCanStart({ modelPath: join(tmpdir(), 'missing-coder.gguf'), totalRamGb: 32 })
  const port = await freePort()
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { prompt?: string }
      const ok = typeof body.prompt === 'string' && body.prompt.includes('<|fim_prefix|>') && body.prompt.includes('<|fim_middle|>')
      res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ text: ok ? 'return "06:40"' : '' }] }))
    })
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  const text = await fimComplete(`http://127.0.0.1:${port}`, 'test-key', 'export function ferryLeave() {\n  ', '\n}')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return {
    id: 'fim-sidecar',
    suite: 'code',
    weight: 2,
    fields: {
      needsDownload: blocked.ok === false && blocked.reason.includes('Download'),
      suggestion: text === 'return "06:40"',
    },
  }
}

async function mcpRow(agentsRoot: string): Promise<Measurement> {
  const script = join(agentsRoot, 'assistant/harbor-mcp.mjs')
  const gate = new ApprovalGate()
  const client = await McpStdio.connect(process.execPath, [script])
  const read = await client.call('harbor.note.read', {}, gate, 1)
  const blocked = await client.call('harbor.note.write', { text: 'Pier 4 is closed.' }, gate, 2)
  const written = await client.call('harbor.note.write', { text: 'Pier 4 is closed.' }, gate, 3)
  const again = await client.call('harbor.note.read', {}, gate, 4)
  client.close()
  const port = await freePort()
  const child = spawn(process.execPath, [script, '--http', String(port)], { stdio: 'ignore' })
  await new Promise((resolve) => setTimeout(resolve, 200))
  let allowed = false
  try {
    const listed = await mcpHttp(`http://127.0.0.1:${port}/mcp`, ['127.0.0.1'], 'tools/list', {}) as { result?: { tools?: unknown[] } }
    allowed = Array.isArray(listed.result?.tools)
  } catch { allowed = false }
  let denied = false
  try {
    await mcpHttp('https://evil.example/mcp', ['127.0.0.1'], 'tools/list', {})
  } catch { denied = true }
  child.kill()
  return {
    id: 'mcp-client',
    suite: 'code',
    weight: 3,
    fields: {
      read: read.applied === true && read.text.includes('Pier 4 is open'),
      blocked: blocked.applied === false && blocked.state === 'needs-approval',
      wrote: written.applied === true && again.text.includes('closed'),
      http: allowed,
      denied,
    },
  }
}

function bakeRow(agentsRoot: string): Measurement {
  const report = JSON.parse(readFileSync(join(agentsRoot, 'code/bakeoff.json'), 'utf8')) as {
    winner: string
    coderank: string
    qwenEmbedding: string
    scores: { bm25: number; gemma: number; qwen: number; hybrid: number }
  }
  return {
    id: 'bakeoff-result',
    suite: 'code',
    weight: 2,
    fields: {
      consistent: pickWinner(report.scores) === report.winner && report.scores.bm25 === bm25Recall(),
      noCoderank: report.coderank === 'not-feasible',
      measured: report.qwenEmbedding === 'measured',
      known: report.winner === 'bm25-symbols' || report.winner === 'hybrid' || report.winner === 'embeddinggemma' || report.winner === 'qwen3-embedding',
    },
  }
}

async function connectorRows(): Promise<Measurement[]> {
  const cloud = await startMockCloud()
  const dir = mkdtempSync(join(tmpdir(), 'surf-vault-'))
  const cipher = aesCipher(randomBytes(32))
  const login: boolean[] = []
  const notes: string[] = []
  const hub = new ConnectorHub({
    dir,
    cipher,
    apiBase: cloud.base,
    open: async (url) => { await fetch(url) },
    notify: (title) => notes.push(title),
    login: (open) => login.push(open),
  })
  const google = cloud.endpoints('google', devPlaceholder('google'))
  const microsoft = cloud.endpoints('microsoft', devPlaceholder('microsoft'))
  const slack = cloud.endpoints('slack', devPlaceholder('slack'))
  const gmail = await hub.connect(google, ['gmail'])
  const calendar = await hub.connect(google, ['calendar'])
  const ms = await hub.connect(microsoft, ['mail'])
  const slackToken = await hub.connect(slack, [])
  const mail = hub.cachedMail().find((row) => row.provider === 'google')
  const refreshed = await hub.fresh(google, Date.now())
  const leaked = hub.fileBytes().toString('utf8').includes(refreshed)
  await hub.disconnect(slack, true)
  const queued = await hub.queueSend({ id: 'out-1', provider: 'google', to: 'ada@harbor.example', subject: 'Re: Berth', body: 'The berth is North.', runAt: null }, 10_000)
  const earlyFlush = await hub.flush(10_100, true)
  const approved = await hub.approve('out-1', 10_200)
  const offline = await hub.flush(10_300, false)
  const reloaded = new ConnectorHub({ dir, cipher, apiBase: cloud.base, fetchImpl: fetch })
  await reloaded.load()
  const online = await reloaded.flush(10_400, true)
  await hub.reread()
  const when = Date.parse('2026-10-11T09:00:00.000Z')
  const scheduled = await hub.queueSend({ id: 'sched-1', provider: 'google', to: 'ada@harbor.example', subject: 'Tomorrow', body: 'See you at the pier.', runAt: when }, 20_000)
  await hub.approve('sched-1', 20_100)
  const notYet = await hub.flush(20_200, true)
  const later = await hub.flush(when + 1000, true)
  await hub.scheduleAlarm('alarm-1', 'Pier check', 'Leave for pier 4', when)
  const quiet = await hub.tick(when - 1000)
  const fired = await hub.tick(when + 1000)
  const gst = draftInvoice('gst-india', [{ label: 'राशि', cents: 100_000 }], 2026, 6)
  const pdf = await invoicePdf(gst)
  const docx = await invoiceDocx(gst)
  const sheet = readSheet(invoiceXlsx(gst))
  const pdfText = (await pdfItems(pdf)).map((item) => item.str).join(' ')
  const docxText = await docxXml(docx)
  const invoiceSend = await hub.queueSend({
    id: 'inv-1',
    provider: 'google',
    to: 'ada@harbor.example',
    subject: gst.number,
    body: 'Invoice attached.',
    attachment: { filename: `${gst.number}.pdf`, mime: 'application/pdf', base64: pdf.toString('base64') },
    runAt: when,
  }, 30_000)
  const held = await hub.flush(30_100, true)
  await hub.approve('inv-1', 30_200)
  const sentInvoice = await hub.flush(when + 2000, true)
  const attached = hub.outbox().find((item) => item.id === 'inv-1')
  hub.requestTrash('google', 'm1', 40_000)
  await hub.confirmTrash('google', 'm1', 40_100)
  const tooSoon = await hub.confirmTrash('google', 'm1', 40_200)
  const waited = await hub.confirmTrash('google', 'm1', 46_000)
  await cloud.close()
  return [
    {
      id: 'oauth-mock',
      suite: 'assistant',
      weight: 3,
      fields: {
        gmail: gmail.scopes.some((scope) => scope.includes('gmail.readonly')) && !gmail.scopes.some((scope) => scope.includes('calendar')),
        incremental: calendar.scopes.some((scope) => scope.includes('calendar.events')) && calendar.scopes.some((scope) => scope.includes('gmail.readonly')),
        filtered: Boolean(mail && mail.body.includes('North') && !mail.body.includes('PWNED')),
        events: hub.cachedEvents().some((row) => row.title === 'Pier check'),
        refresh: refreshed !== gmail.accessToken,
        sealed: leaked === false,
        microsoft: ms.account === 'ada@harbor.example',
        slack: slackToken.accessToken.startsWith('atk-slack'),
        revoked: cloud.revoked >= 1 && hub.token('slack') == null,
      },
    },
    {
      id: 'outbox-schedule',
      suite: 'assistant',
      weight: 3,
      fields: {
        held: queued.applied === false && earlyFlush.sent === 0,
        approved: approved.applied === true && offline.sent === 0 && online.sent === 1,
        scheduled: scheduled.applied === false && notYet.sent === 0 && later.sent >= 1,
        alarm: quiet.length === 0 && fired.length === 1 && notes.includes('Pier check'),
        login: login.some((open) => open === true),
      },
    },
    {
      id: 'invoice-files',
      suite: 'assistant',
      weight: 3,
      fields: {
        pdf: pdfText.includes(gst.number) && pdfText.includes('1180.00'),
        docx: docxText.includes('राशि'),
        xlsx: sheet.some((row) => row.join(' ').includes('1180.00')),
        gate: invoiceSend.applied === false && held.sent === 0 && sentInvoice.sent >= 1,
        attachment: Boolean(attached?.attachment?.base64 && attached.attachment.filename.endsWith('.pdf')),
      },
    },
    {
      id: 'remote-delete',
      suite: 'assistant',
      weight: 3,
      fields: {
        early: tooSoon.trashed === false && tooSoon.state === 'wait',
        trashed: waited.trashed === true && cloud.trashed.length === 1,
      },
    },
  ]
}
