import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import { fileURLToPath } from 'node:url'
import { heuristicCounter } from './token-budget.js'
import { hashEmbedder } from './code/embed.js'
import { CodeIndex } from './code/project.js'
import { fuseRanks } from './code/search.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/tree-sitter')
const key = 'cd'.repeat(32)

function project(files: Record<string, string>, embed = true): { root: string; index: CodeIndex; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'surf-search-'))
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
    embedder: embed ? hashEmbedder() : null,
  })
  return { root, index, cleanup: () => { index.close(); rmSync(root, { recursive: true, force: true }) } }
}

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('reciprocal rank fusion keeps a vector-only hit and a keyword hit', () => {
  const fused = fuseRanks([10, 11], [{ id: 11, cosine: 0.2 }, { id: 12, cosine: 0.9 }])
  assert.equal(fused.get(10)?.bm25Rank, 0)
  assert.equal(fused.get(10)?.vecRank, null)
  assert.equal(fused.get(12)?.bm25Rank, null)
  assert.equal(fused.get(12)?.vecRank, 1)
  assert.ok((fused.get(11)?.rrf ?? 0) > (fused.get(10)?.rrf ?? 0))
  assert.ok((fused.get(11)?.rrf ?? 0) > (fused.get(12)?.rrf ?? 0))
})

test('hybrid search ranks the symbol over a keyword dump, and rerank prefers the name', async () => {
  const spam = 'ferry '.repeat(40)
  const fixture = project({
    'src/schedule.ts': 'export function ferryDeparture() {\n  return "the harbor ferry leaves pier 4 at 06:40"\n}\n',
    'src/noise.ts': `export function notes() {\n  return "${spam}"\n}\n`,
    'src/kitchen.ts': 'export function pizzaRecipe() {\n  return "pineapple belongs nowhere"\n}\n',
  })
  try {
    const status = await fixture.index.run()
    assert.equal(status.embeddings, 'ready')
    assert.equal(status.encrypted, true)
    const hits = await fixture.index.search('ferryDeparture')
    assert.equal(hits[0]?.name, 'ferryDeparture')
    const phrase = await fixture.index.search('when does the harbor ferry leave')
    assert.equal(phrase[0]?.name, 'ferryDeparture')
    assert.ok(phrase[0]!.score >= phrase[phrase.length - 1]!.score)
  } finally {
    fixture.cleanup()
  }
})

test('context builder stays inside the token budget and names files', async () => {
  const fixture = project({
    'src/schedule.ts': 'export function ferryDeparture() {\n  return "the harbor ferry leaves pier 4 at 06:40"\n}\n',
    'src/kitchen.ts': 'export function pizzaRecipe() {\n  return "pineapple"\n}\n' + 'const filler = "' + 'word '.repeat(400) + '"\n',
  }, false)
  try {
    await fixture.index.run()
    const pack = await fixture.index.context('where is ferryDeparture', { tokenBudget: 80, counter: heuristicCounter, maxSnippets: 4 })
    assert.ok(pack.snippets.length >= 1)
    assert.ok(pack.snippets.some((snippet) => snippet.symbol === 'ferryDeparture' && snippet.reason === 'definition'))
    assert.ok(pack.files.includes('src/schedule.ts'))
    assert.ok(pack.tokens <= 80)
    assert.ok(pack.dropped >= 0)
    const wide = await fixture.index.context('harbor ferry schedule', { tokenBudget: 400, counter: heuristicCounter })
    assert.ok(wide.snippets.some((snippet) => snippet.path === 'src/schedule.ts'))
  } finally {
    fixture.cleanup()
  }
})
