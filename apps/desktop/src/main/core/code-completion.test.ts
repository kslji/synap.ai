import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import { fileURLToPath } from 'node:url'
import { acceptAll, acceptWord } from '../../shared/completion-edit.js'
import { CodeIndex } from './code/project.js'
import { CompletionCache } from './code-agent/completion/cache.js'
import { LatestCall } from './code-agent/completion/debounce.js'
import { listEditorFiles, readEditorFile, saveEditorFile } from './code-agent/completion/editor-files.js'
import { FIM_MIDDLE, FIM_PREFIX, FIM_SUFFIX, buildCompletionPrompt, fimFromProbe } from './code-agent/completion/fim.js'
import { startCompletionHttp } from './code-agent/completion/http-api.js'
import { languageSuggestionsOn, tabSuggestionsDefault } from './code-agent/completion/policy.js'
import { balanceBrackets, finishCompletion, isOnlyRepeat, stopAtBoundary, trimSuffixOverlap } from './code-agent/completion/post.js'
import { createCompletionRuntime } from './code-agent/completion/runtime.js'
import { CompletionService, type CompletionHost, type CompletionInput } from './code-agent/completion/service.js'
import { selectSnippets } from './code-agent/completion/snippets.js'
import { completionSpan, fileWindows, predictBudget } from './code-agent/completion/windows.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/tree-sitter')

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('FIM prompt uses Qwen markers and prefix-only leaves the suffix out', () => {
  const fim = buildCompletionPrompt({
    prefix: 'const name = ',
    suffix: '\n}',
    path: 'src/app.ts',
    snippets: [{ path: 'src/util.ts', symbol: 'label', text: 'export function label() { return 1 }' }],
    fim: true,
  })
  assert.equal(fim.mode, 'fim')
  assert.ok(fim.prompt.startsWith(FIM_PREFIX))
  assert.ok(fim.prompt.includes('# src/util.ts label'))
  assert.ok(fim.prompt.indexOf('# src/util.ts label') < fim.prompt.indexOf('const name = '))
  assert.ok(fim.prompt.includes(`${FIM_SUFFIX}\n}`))
  assert.ok(fim.prompt.endsWith(FIM_MIDDLE))
  const prefixOnly = buildCompletionPrompt({
    prefix: 'const name = ',
    suffix: 'KEEP_SUFFIX',
    path: 'src/app.ts',
    snippets: [],
    fim: false,
  })
  assert.equal(prefixOnly.mode, 'prefix')
  assert.equal(prefixOnly.prompt, 'const name = ')
  assert.equal(prefixOnly.prompt.includes(FIM_PREFIX), false)
  assert.equal(prefixOnly.prompt.includes('KEEP_SUFFIX'), false)
})

test('FIM support follows the tokenizer probe, then the model id', () => {
  assert.equal(fimFromProbe(1, 'gemma-4-e2b'), true)
  assert.equal(fimFromProbe(4, 'qwen3.5-2b-q6_k'), false)
  assert.equal(fimFromProbe(null, 'qwen3.5-2b-q6_k'), true)
  assert.equal(fimFromProbe(null, 'qwen2.5-coder-7b'), true)
  assert.equal(fimFromProbe(null, 'qwen3-coder'), true)
  assert.equal(fimFromProbe(null, 'qwen2.5-7b'), false)
  assert.equal(fimFromProbe(null, 'gemma-4-e2b'), false)
})

test('windows, line cap, and block cap', () => {
  const windows = fileWindows('abc\n' + 'x'.repeat(20), 4)
  assert.equal(windows.line, 2)
  assert.equal(windows.prefix, 'abc\n')
  const wide = fileWindows('a'.repeat(8_000) + '|tail', 8_000)
  assert.equal(wide.prefix.length, 6_000)
  assert.equal(wide.suffix, '|tail')
  assert.equal(completionSpan('const x = ', ''), 'line')
  assert.equal(completionSpan('function f() {\n', '\n}'), 'block')
  assert.equal(completionSpan('def run():\n', '\n'), 'block')
  assert.equal(predictBudget('line').maxTokens < predictBudget('block').maxTokens, true)
  assert.ok(predictBudget('line').stop.includes('\n'))
  assert.equal(predictBudget('line').stop.includes('\n\n'), false)
})

test('overlap trim, bracket balance, repeat drop, and boundary stop', () => {
  assert.equal(trimSuffixOverlap('bar()', '()'), 'bar')
  assert.equal(trimSuffixOverlap('keep', 'other'), 'keep')
  assert.equal(balanceBrackets('foo('), 'foo()')
  assert.equal(balanceBrackets('({['), '({[]})')
  assert.equal(balanceBrackets('foo(bar))'), 'foo(bar)')
  assert.equal(balanceBrackets('say("(")'), 'say("(")')
  assert.equal(balanceBrackets(')'), '')
  assert.equal(finishCompletion('foo(', 'const ', ')', 'line'), 'foo(')
  assert.equal(finishCompletion('foo(', 'const ', '', 'line'), 'foo()')
  assert.equal(finishCompletion('return', 'return', '\n', 'line'), '')
  assert.equal(isOnlyRepeat('  name', 'const name', ''), true)
  assert.equal(stopAtBoundary('one\ntwo', 'line'), 'one')
  assert.equal(stopAtBoundary('    line\n    more\n\n    later', 'block'), '    line\n    more')
  assert.equal(stopAtBoundary('    line\noutside', 'block'), '    line')
  assert.equal(finishCompletion('only\nrest', 'const ', '', 'line'), 'only')
})

test('debounce drops the waiting call and aborts the in-flight call', async () => {
  const slot: { fn: (() => void) | null } = { fn: null }
  const gate = new LatestCall(200, {
    set(fn) { slot.fn = fn; return 1 },
    clear() { slot.fn = null },
  })
  let ran = 0
  const first = gate.run(async () => { ran += 1; return 'one' })
  const second = gate.run(async () => { ran += 1; return 'two' })
  assert.ok(slot.fn)
  slot.fn()
  assert.equal(await first, null)
  assert.equal(await second, 'two')
  assert.equal(ran, 1)

  const flight: { fn: (() => void) | null } = { fn: null }
  const live = new LatestCall(0, {
    set(fn) { flight.fn = fn; return 1 },
    clear() { flight.fn = null },
  })
  let aborted = false
  const hanging = live.run((signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted = true
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    })
  }))
  flight.fn?.()
  const next = live.run(async () => 'next')
  assert.equal(aborted, true)
  const resume = flight.fn
  if (resume) resume()
  assert.equal(await hanging, null)
  assert.equal(await next, 'next')
})

test('prefix cache extends a previous completion and evicts the oldest', () => {
  const cache = new CompletionCache(2)
  cache.put({ prefix: 'const ', suffix: '\n', language: 'typescript' }, 'name = 1')
  assert.equal(cache.get({ prefix: 'const n', suffix: '\n', language: 'typescript' }), 'ame = 1')
  assert.equal(cache.get({ prefix: 'const ', suffix: '\n', language: 'python' }), null)
  assert.equal(cache.get({ prefix: 'let ', suffix: '\n', language: 'typescript' }), null)
  cache.put({ prefix: 'a', suffix: '', language: 'go' }, '1')
  cache.put({ prefix: 'b', suffix: '', language: 'go' }, '2')
  assert.equal(cache.get({ prefix: 'const ', suffix: '\n', language: 'typescript' }), null)
  assert.equal(cache.size, 2)
})

test('snippet budget keeps imported symbols ahead of nearby ones', async () => {
  const picked = await selectSnippets(
    [{ path: 'util.ts', symbol: 'label', text: 'export function label() { return 1 }', reason: 'import' }],
    [
      { path: 'util.ts', symbol: 'label', text: 'duplicate', reason: 'nearby' },
      { path: 'app.ts', symbol: 'huge', text: 'x'.repeat(400), reason: 'nearby' },
      { path: 'app.ts', symbol: 'run', text: 'function run() {}', reason: 'nearby' },
    ],
    40,
    async (text) => Math.ceil(text.length / 3.2),
  )
  assert.equal(picked[0]?.symbol, 'label')
  assert.equal(picked.some((item) => item.symbol === 'huge'), false)
  assert.ok(picked.some((item) => item.symbol === 'run'))
})

test('the model call reuses the prompt cache and falls back when FIM markers are absent', async () => {
  let cachePrompt = false
  let sawMarker = false
  const fimHost = fakeHost({
    complete: async (req) => {
      cachePrompt = req.cachePrompt
      sawMarker = req.prompt.includes('<|fim_prefix|>')
      return 'ready'
    },
  })
  await new CompletionService(fimHost, 0).suggest(input('const '))
  assert.equal(cachePrompt, true)
  assert.equal(sawMarker, true)
  let plain = ''
  const prefixHost = fakeHost({
    probeFim: async () => 6,
    modelId: () => 'qwen3.5-2b-q6_k',
    complete: async (req) => {
      plain = req.prompt
      return ''
    },
  })
  await new CompletionService(prefixHost, 0).suggest(input('const value = '))
  assert.equal(plain.includes('<|fim_prefix|>'), false)
  assert.equal(plain.includes('const value = '), true)
  assert.equal(plain.endsWith('const value = '), true)
})

test('the service cancels an in-flight model call and then serves the cache', async () => {
  let calls = 0
  const host = fakeHost({
    complete: (req) => new Promise((resolve, reject) => {
      calls += 1
      const timer = setTimeout(() => resolve(calls === 1 ? 'slow' : 'name'), 40)
      req.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }),
  })
  const service = new CompletionService(host, 15)
  const first = service.suggest(input('const '))
  await delay(25)
  const second = service.suggest(input('const '))
  const [left, right] = await Promise.all([first, second])
  assert.equal(left.text, '')
  assert.equal(right.text, 'name')
  assert.equal(right.cached, false)
  const again = await service.suggest(input('const n'))
  assert.equal(again.cached, true)
  assert.equal(again.text, 'ame')
  assert.equal(calls, 2)
})

test('Tab suggestions default to on only when the Code model fits', () => {
  assert.equal(tabSuggestionsDefault(3.8, 4), true)
  assert.equal(tabSuggestionsDefault(8, 8), true)
  assert.equal(tabSuggestionsDefault(8, 16), false)
  assert.equal(tabSuggestionsDefault(15.6, 32), false)
  assert.equal(languageSuggestionsOn('TypeScript', ['typescript', 'markdown']), false)
  assert.equal(languageSuggestionsOn('python', ['markdown']), true)
})

test('accepting ghost text edits the buffer and does not need a file write', () => {
  const all = acceptAll('const ', 6, 'name = 1')
  assert.equal(all.text, 'const name = 1')
  assert.equal(all.cursor, 14)
  const word = acceptWord('const ', 6, 'name = 1')
  assert.equal(word.text, 'const name')
  assert.equal(word.rest, ' = 1')
  assert.equal(word.cursor, 10)
})

test('editor save is separate from completion, and paths stay in the project', () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-edit-'))
  try {
    writeFileSync(join(root, 'app.ts'), 'const a = 1\n')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'util.ts'), 'export const n = 1\n')
    const listed = listEditorFiles(root).map((file) => file.path).sort()
    assert.deepEqual(listed, ['app.ts', 'src/util.ts'])
    assert.equal(readEditorFile(root, 'src/util.ts').language, 'typescript')
    assert.throws(() => readEditorFile(root, '../app.ts'), /outside/)
    const before = statSync(join(root, 'app.ts')).mtimeMs
    assert.equal(readEditorFile(root, 'app.ts').text, 'const a = 1\n')
    assert.equal(statSync(join(root, 'app.ts')).mtimeMs, before)
    assert.equal(saveEditorFile(root, 'app.ts', 'const a = 2\n').path, 'app.ts')
    assert.equal(readFileSync(join(root, 'app.ts'), 'utf8'), 'const a = 2\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('completion hints pull imported symbols and nearby definitions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-hints-'))
  const index = new CodeIndex({
    root,
    dbPath: join(root, 'index.sqlite'),
    keyHex: null,
    grammarDir,
    embedder: null,
  })
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'util.py'), 'def format_name(value):\n    return value\n')
    writeFileSync(join(root, 'src', 'harbor.py'), 'from src.util import format_name\n\ndef depart():\n    return format_name("ferry")\n')
    await index.run()
    const hints = await index.completionHints('src/harbor.py', 4)
    assert.ok(hints.imported.some((hit) => hit.name === 'format_name' && hit.path === 'src/util.py'))
    const nearby = await index.completionHints('src/util.py', 3)
    assert.ok(nearby.nearby.some((hit) => hit.name === 'format_name'))
  } finally {
    index.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('loopback completion API checks the bearer token and does not write the project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-api-'))
  const userData = mkdtempSync(join(tmpdir(), 'surf-api-user-'))
  writeFileSync(join(root, 'app.ts'), 'const a = 1\n')
  const before = readFileSync(join(root, 'app.ts'), 'utf8')
  const runtime = createCompletionRuntime({
    userData,
    enabled: () => true,
    languagesOff: () => [],
    modelId: () => 'qwen3.5-2b-q6_k',
    root: () => root,
    indexed: () => null,
    server: async () => null,
    log: () => undefined,
  })
  try {
    const port = await waitForPort(runtime)
    const file = JSON.parse(readFileSync(join(userData, 'completion-api.json'), 'utf8')) as { port: number; token: string; host: string }
    assert.equal(file.host, '127.0.0.1')
    assert.equal(file.port, port)
    const denied = await fetch(`http://127.0.0.1:${port}/v1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input('const ')),
    })
    assert.equal(denied.status, 401)
    const health = await fetch(`http://127.0.0.1:${port}/v1/health`, { headers: { Authorization: `Bearer ${file.token}` } })
    assert.equal(health.status, 200)
    const allowed = await fetch(`http://127.0.0.1:${port}/v1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${file.token}` },
      body: JSON.stringify({ ...input('const '), sessionId: 'ext' }),
    })
    assert.equal(allowed.status, 200)
    const body = await allowed.json() as { text: string }
    assert.equal(body.text, '')
    assert.equal(readFileSync(join(root, 'app.ts'), 'utf8'), before)
    const direct = startCompletionHttp(async () => ({ text: 'ok' }))
    const endpoint = await direct
    const bad = await fetch(`http://127.0.0.1:${endpoint.port}/v1/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: '{}',
    })
    assert.equal(bad.status, 401)
    await endpoint.close()
  } finally {
    await runtime.close()
    rmSync(root, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

function input(text: string): CompletionInput {
  return { sessionId: 's', path: 'app.ts', language: 'typescript', text, cursor: text.length }
}

function fakeHost(over: Partial<CompletionHost> & Pick<CompletionHost, 'complete'>): CompletionHost {
  return {
    enabled: () => true,
    languageOn: () => true,
    modelId: () => 'qwen3.5-2b-q6_k',
    probeFim: async () => 1,
    snippets: async () => ({ imported: [], nearby: [] }),
    log: () => undefined,
    ...over,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForPort(runtime: { endpoint(): { port: number } }): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = runtime.endpoint().port
    if (port > 0) return port
    await delay(20)
  }
  throw new Error('completion api did not listen')
}
