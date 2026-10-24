import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nameBoost, rerankHits, rerankWithModel, type CodeHit } from './search.js'

function hit(over: Partial<CodeHit> & { chunkId: number; path: string; name: string }): CodeHit {
  return {
    kind: 'function',
    startLine: 1,
    endLine: 2,
    text: '',
    bm25Rank: null,
    vecRank: null,
    cosine: 0,
    rrf: 0.5,
    score: 0,
    ...over,
  }
}

test('a task that names the file ranks that file before an equal chunk elsewhere', () => {
  const named = hit({ chunkId: 1, path: 'src/parser.ts', name: 'parse', text: 'export function parse() {}' })
  const other = hit({ chunkId: 2, path: 'src/render.ts', name: 'paint', text: 'export function paint() {}' })
  const ranked = rerankHits([other, named], 'fix src/parser.ts')
  assert.equal(ranked[0]?.path, 'src/parser.ts')
  assert.ok(nameBoost('parse', 'function', 'fix src/parser.ts', { path: 'src/parser.ts' }) > nameBoost('parse', 'function', 'fix src/parser.ts'))
})

test('an exported symbol beats a private helper with the same name', () => {
  const exported = hit({ chunkId: 1, path: 'a.ts', name: 'load', text: 'export function load() {}' })
  const hidden = hit({ chunkId: 2, path: 'b.ts', name: 'load', text: 'function load() {}' })
  const ranked = rerankHits([hidden, exported], 'where is load')
  assert.equal(ranked[0]?.path, 'a.ts')
})

test('a file imported by the best hit is promoted over an unrelated tie', () => {
  const neighbour = hit({ chunkId: 1, path: 'src/types.ts', name: 'Options', text: 'export type Options = {}' })
  const unrelated = hit({ chunkId: 2, path: 'docs/notes.ts', name: 'Options', text: 'export type Options = {}' })
  const plain = rerankHits([unrelated, neighbour], 'options')
  const boosted = rerankHits([unrelated, neighbour], 'options', new Set(['src/types.ts']))
  // Equal scores fall back to the path: docs/notes.ts sorts first until the neighbour boost applies.
  assert.equal(plain[0]?.path, 'docs/notes.ts')
  assert.equal(boosted[0]?.path, 'src/types.ts')
})

test('a reranker that answers reorders, and one that fails leaves the boost order alone', async () => {
  const first = hit({ chunkId: 1, path: 'a.ts', name: 'alpha', text: 'export function alpha() {}' })
  const second = hit({ chunkId: 2, path: 'b.ts', name: 'beta', text: 'export function beta() {}' })
  const ranked = rerankHits([first, second], 'alpha beta')
  assert.deepEqual(ranked.map((row) => row.path), ['a.ts', 'b.ts'])

  const reversed = await rerankWithModel(ranked, 'alpha beta', { rerank: async () => [0, 10] })
  assert.equal(reversed.neural, true)
  assert.deepEqual(reversed.hits.map((row) => row.path), ['b.ts', 'a.ts'])
  const flipped = await rerankWithModel(ranked, 'alpha beta', { rerank: async () => [0, 0] })
  assert.equal(flipped.neural, true)
  assert.deepEqual(flipped.hits.map((row) => row.path), ['a.ts', 'b.ts'])

  const throwing = await rerankWithModel(ranked, 'alpha beta', { rerank: async () => { throw new Error('sidecar is down') } })
  assert.equal(throwing.neural, false)
  assert.deepEqual(throwing.hits.map((row) => row.path), ['a.ts', 'b.ts'])

  const short = await rerankWithModel(ranked, 'alpha beta', { rerank: async () => [5] })
  assert.equal(short.neural, false)
  const none = await rerankWithModel(ranked, 'alpha beta', null)
  assert.equal(none.neural, false)
})
