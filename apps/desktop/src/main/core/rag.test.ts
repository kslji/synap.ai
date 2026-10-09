import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { chunkBlocks, CHUNK_OVERLAP, CHUNK_TARGET } from './chunker.js'
import { convertBytes } from './convert.js'
import { openUserDb } from './db.js'
import { EMBEDDINGGEMMA2_256, formatDoc, formatQuery, truncateNormalize } from './embedding.js'
import { addBytes, deleteAttachment, listFiles, saveChunks } from './library-store.js'
import { LIBRARY_MIGRATION } from './library-schema.js'
import { documentGate, isDevanagariQuery, rrfScore, type Hit } from './retrieval.js'
import { SESSION_MIGRATION } from './session-store.js'
import { makeDocx, makePdf, makePptx } from './samples.js'
import { searchUser } from './user-search.js'

const opts = { tessdataDir: '/tmp/unused-tess', tessCacheDir: '/tmp/unused-tess-cache' }

test('chunks keep headings, pages, and overlap', () => {
  const words = Array.from({ length: 500 }, (_, i) => `w${String(i).padStart(3, '0')}`)
  const long = chunkBlocks([{ text: words.join(' '), heading: 'Fuel', page: 2 }])
  assert.ok(long.length >= 2)
  assert.equal(long[0].wordCount, CHUNK_TARGET)
  assert.equal(long[0].heading, 'Fuel')
  assert.equal(long[0].locatorLabel, '2')
  assert.equal(long[0].locatorKind, 'page')
  const overlap = words.slice(CHUNK_TARGET - CHUNK_OVERLAP, CHUNK_TARGET).join(' ')
  assert.ok(long[1].text.includes(overlap))

  const split = chunkBlocks([
    { text: 'alpha '.repeat(20), heading: 'Pier', slide: 1 },
    { text: 'beta '.repeat(20), heading: 'Tickets', slide: 2 },
  ])
  assert.equal(split.length, 2)
  assert.equal(split[0].heading, 'Pier')
  assert.equal(split[0].locatorKind, 'slide')
  assert.equal(split[1].locatorLabel, '2')

  const sheet = chunkBlocks([{ text: 'sku rope 40', heading: 'Stock', sheet: 'Warehouse' }])
  assert.equal(sheet[0].locatorKind, 'sheet')
  assert.equal(sheet[0].locatorLabel, 'Warehouse')
})

test('embedding prefixes and matryoshka normalisation', () => {
  assert.equal(formatQuery(EMBEDDINGGEMMA2_256, '  pier 4 '), 'task: search result | query: pier 4')
  assert.equal(formatDoc(EMBEDDINGGEMMA2_256, '', 'hello'), 'title: none | text: hello')
  assert.equal(formatDoc(EMBEDDINGGEMMA2_256, 'Ferry', 'leaves at dawn'), 'title: Ferry | text: leaves at dawn')
  const raw = new Array(768).fill(0)
  raw[0] = 3
  raw[1] = 4
  const out = truncateNormalize(raw, 256)
  assert.equal(out.length, 256)
  const norm = Math.hypot(...out)
  assert.ok(Math.abs(norm - 1) < 1e-5)
  assert.throws(() => truncateNormalize(new Array(768).fill(0), 256))
})

test('relevance gate and reciprocal rank fusion', () => {
  const hit = (cosine: number, text: string): Hit => ({
    pack: 'library', chunkId: 1, text, title: 't', url: '', cosine, bm25Rank: 0, vecRank: 0, rrf: 0,
  })
  assert.equal(documentGate('when does the ferry leave', []), 'insufficient')
  assert.equal(documentGate('when does the ferry leave', [hit(0.86, 'the harbor ferry leaves pier 4 at dawn')]), 'answer')
  assert.equal(documentGate('best pizza recipe', [hit(0.42, 'the harbor ferry leaves pier 4')]), 'insufficient')
  assert.equal(isDevanagariQuery('नौका किस घाट से निकलती है'), true)
  assert.equal(documentGate('नौका किस घाट से निकलती है', [hit(0.8, 'pier 4')]), 'answer')
  assert.equal(documentGate('नौका किस घाट से निकलती है', [hit(0.4, 'pier 4')]), 'insufficient')
  assert.equal(rrfScore([0, null]), 1 / 61)
  assert.ok(rrfScore([0, 0]) > rrfScore([0, 5]))
  assert.equal(rrfScore([null, null]), 0)
})

test('pdf, docx, pptx, and csv become blocks', async () => {
  const pdf = await convertBytes('ferry.pdf', makePdf(['The harbor ferry leaves Pier 4 at 06:40. Tickets cost 120 rupees.']), opts)
  assert.ok(pdf.some((block) => block.text.includes('06:40') && block.page === 1))
  const docx = await convertBytes('invoice.docx', await makeDocx([
    { heading: true, text: 'Northwind invoice' },
    { text: 'Invoice INV-441 is due on 18 April 2026 for 408.50 USD.' },
  ]), opts)
  assert.ok(docx.some((block) => block.text.includes('INV-441')))
  assert.equal(docx.find((block) => block.text.includes('INV-441'))?.heading, 'Northwind invoice')
  const pptx = await convertBytes('brief.pptx', await makePptx([['Tide window', 'High water at 14:10']]), opts)
  assert.equal(pptx[0].slide, 1)
  assert.ok(pptx[0].text.includes('14:10'))
  const csv = await convertBytes('stock.csv', Buffer.from('sku,qty\nrope,40\n'), opts)
  assert.ok(csv[0].sheet)
  assert.ok(csv[0].text.includes('rope'))
})

test('index dedupes by hash, searches, and deletes chunks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-rag-'))
  const db = openUserDb(join(dir, 'user.db'), 'ab'.repeat(32), [SESSION_MIGRATION, LIBRARY_MIGRATION])
  try {
    const ferry = Buffer.from('The harbor ferry leaves Pier 4 at 06:40.')
    const first = addBytes(db, join(dir, 'files'), 'harbor-ferry.txt', 'text/plain', ferry, null)
    const again = addBytes(db, join(dir, 'files'), 'harbor-ferry.txt', 'text/plain', ferry, null)
    assert.equal(again.attachmentId, first.attachmentId)
    assert.equal(again.created, false)
    const pizza = addBytes(db, join(dir, 'files'), 'pizza.txt', 'text/plain', Buffer.from('Pizza dough needs yeast and a hot oven.'), null)
    const relevant = unitVector(0)
    const other = unitVector(1)
    const ferryChunks = chunkBlocks([{ text: ferry.toString() }])
    const pizzaChunks = chunkBlocks([{ text: 'Pizza dough needs yeast and a hot oven.' }])
    saveChunks(db, first.attachmentId, ferryChunks, [relevant])
    saveChunks(db, pizza.attachmentId, pizzaChunks, [other])
    const found = searchUser(db, 'what time does the harbor ferry leave', relevant, null)
    assert.equal(found.decision, 'answer')
    assert.equal(found.top[0].fileName, 'harbor-ferry.txt')
    assert.equal(listFiles(db).length, 2)
    deleteAttachment(db, first.attachmentId, join(dir, 'files'))
    const after = searchUser(db, 'harbor ferry pier', relevant, null)
    assert.ok(after.top.every((hit) => hit.fileName !== 'harbor-ferry.txt'))
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

function unitVector(index: number): Float32Array {
  const v = new Float32Array(256)
  v[index] = 1
  return v
}
