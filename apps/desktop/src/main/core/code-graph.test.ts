import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import { fileURLToPath } from 'node:url'
import { hashEmbedder } from './code/embed.js'
import { referencesWithFallback, lspReferences, detectLanguageServers } from './code/lsp.js'
import { CodeIndex } from './code/project.js'
import { resolveModule } from './code/store.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/tree-sitter')
const key = 'ab'.repeat(32)

function project(files: Record<string, string>): { root: string; index: CodeIndex; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'surf-graph-'))
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
  const index = new CodeIndex({
    root,
    dbPath: join(root, '.index.sqlite'),
    keyHex: key,
    grammarDir,
    embedder: hashEmbedder(),
  })
  return { root, index, cleanup: () => { index.close(); rmSync(root, { recursive: true, force: true }) } }
}

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('definition, references, related files, and impact', async () => {
  const fixture = project({
    'src/harbor.py': 'from src.util import format_name\n\ndef depart():\n    return format_name("ferry")\n\nclass Pier:\n    def open(self):\n        depart()\n',
    'src/util.py': 'def format_name(value):\n    return value\n',
    'src/notes.md': '# Harbor\n\nSee depart for the schedule.\n',
  })
  try {
    await fixture.index.run()
    const defs = await fixture.index.definition('depart')
    assert.equal(defs.length, 1)
    assert.equal(defs[0]?.path, 'src/harbor.py')
    assert.equal(defs[0]?.kind, 'function')
    assert.ok(defs[0]!.startLine >= 1)

    const method = await fixture.index.definition('Pier.open')
    assert.equal(method[0]?.kind, 'method')

    const refs = await fixture.index.references('depart')
    assert.ok(refs.some((ref) => ref.kind === 'calls' && ref.path === 'src/harbor.py' && ref.srcQualified === 'Pier.open'))

    const related = await fixture.index.related('src/harbor.py')
    assert.ok(related.some((file) => file.path === 'src/util.py' && file.reason === 'imports'))

    const impact = await fixture.index.impact('format_name')
    assert.ok(impact.some((hit) => hit.kind === 'calls' && hit.path === 'src/harbor.py' && hit.symbol === 'depart'))
    assert.ok(impact.some((hit) => hit.kind === 'imports'))
  } finally {
    fixture.cleanup()
  }
})

test('resolve relative and dotted modules', () => {
  const files = new Set(['src/util.py', 'src/io.ts', 'src/io/index.ts', 'pkg/mod.py'])
  assert.equal(resolveModule('src/harbor.py', 'src.util', files), 'src/util.py')
  assert.equal(resolveModule('src/harbor.py', './util', files), 'src/util.py')
  assert.equal(resolveModule('src/app.ts', './io', files), 'src/io.ts')
  assert.equal(resolveModule('pkg/app.py', 'pkg.mod', files), 'pkg/mod.py')
  assert.equal(resolveModule('src/app.ts', './missing', files), null)
})

test('language server references win, and a missing server uses the graph', async () => {
  const none = await detectLanguageServers({ PATH: '' })
  assert.equal(none.pyright, null)
  assert.equal(none.typescript, null)

  const graph = [{ path: 'src/harbor.py', line: 4 }]
  const missed = await referencesWithFallback(() => graph, null)
  assert.equal(missed.source, 'graph')
  assert.deepEqual(missed.items, graph)

  const exact = await referencesWithFallback(() => graph, async () => [{ path: 'src/other.py', line: 9 }])
  assert.equal(exact.source, 'lsp')
  assert.equal(exact.items[0]?.path, 'src/other.py')

  const failed = await referencesWithFallback(() => graph, async () => null)
  assert.equal(failed.source, 'graph')
})

test('lsp client reads a reference from a tiny language server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-lsp-'))
  const script = join(root, 'fake-lsp.mjs')
  const source = join(root, 'app.py')
  writeFileSync(source, 'def depart():\n    return 1\n')
  writeFileSync(script, `
import { createInterface } from 'node:readline'
let buf = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk])
  for (;;) {
    const end = buf.indexOf('\\r\\n\\r\\n')
    if (end < 0) return
    const header = buf.subarray(0, end).toString('utf8')
    const len = Number(/Content-Length:\\s*(\\d+)/i.exec(header)[1])
    const start = end + 4
    if (buf.length < start + len) return
    const msg = JSON.parse(buf.subarray(start, start + len).toString('utf8'))
    buf = buf.subarray(start + len)
    if (msg.method === 'initialize') reply(msg.id, { capabilities: {} })
    if (msg.method === 'textDocument/references') {
      reply(msg.id, [{ uri: 'file:///tmp/other.py', range: { start: { line: 3, character: 0 } } }])
    }
    if (msg.method === 'shutdown') reply(msg.id, null)
  }
})
function reply(id, result) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, result }))
  process.stdout.write('Content-Length: ' + body.length + '\\r\\n\\r\\n')
  process.stdout.write(body)
}
`)
  try {
    const refs = await lspReferences({
      command: process.execPath,
      args: [script],
      root,
      file: source,
      languageId: 'python',
      line: 0,
      character: 4,
      timeoutMs: 3000,
    })
    assert.ok(refs)
    assert.equal(refs[0]?.path, '/tmp/other.py')
    assert.equal(refs[0]?.line, 4)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
