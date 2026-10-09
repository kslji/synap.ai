import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openUserDb } from './db.js'
import { LIBRARY_MIGRATION } from './library-schema.js'
import { SESSION_MIGRATION, SessionStore } from './session-store.js'
import { STALE_NOTE, clearSavedWeb, contentHash, saveCitedPassages, savedWebCitation, savedWebStats, searchSavedWeb, WEB_CACHE_MIGRATION } from './web-cache.js'

const KEY = 'ab'.repeat(32)

function db() {
  const dir = mkdtempSync(join(tmpdir(), 'surf-web-cache-'))
  const handle = openUserDb(join(dir, 'user.db'), KEY, [SESSION_MIGRATION, LIBRARY_MIGRATION, WEB_CACHE_MIGRATION])
  return { dir, handle }
}

function chat(handle: ReturnType<typeof openUserDb>, id: string): void {
  const now = Date.now()
  handle.prepare('INSERT INTO conversations (id, title, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, 'Beacon', 'general', now, now)
}

function unitVec(index: number): Float32Array {
  const vec = new Float32Array(256)
  vec[index] = 1
  return vec
}

const passage = {
  url: 'https://example.com/beacon',
  title: 'Pier 9 beacon',
  domain: 'example.com',
  text: 'The Surf beacon code for pier 9 today is SB-4417.',
  published: '2026-10-09',
  fetchedAt: Date.UTC(2026, 9, 9, 12),
  vec: unitVec(0),
}

test('a cited web passage is saved once and answers a later question', () => {
  const { dir, handle } = db()
  try {
    const conv = '11111111-1111-4111-8111-111111111111'
    chat(handle, conv)
    const saved = saveCitedPassages(handle, conv, '22222222-2222-4222-8222-222222222222', [passage, passage], { now: passage.fetchedAt })
    assert.equal(saved, 2)
    assert.equal(savedWebStats(handle).count, 1)
    const again = saveCitedPassages(handle, conv, '33333333-3333-4333-8333-333333333333', [{
      ...passage,
      text: 'The Surf beacon code for pier 9 today is SB-4417. Updated copy.',
    }], { now: passage.fetchedAt })
    assert.equal(again, 1)
    assert.equal(savedWebStats(handle).count, 2)

    const found = searchSavedWeb(handle, 'What beacon code was posted for pier 9?', unitVec(0), conv)
    assert.equal(found.decision, 'answer')
    assert.match(found.top[0].text, /SB-4417/)
    const cite = savedWebCitation(found.top[0], 'What beacon code was posted for pier 9?', passage.fetchedAt + 60_000)
    assert.equal(cite.kind, 'web')
    assert.equal(cite.pack, 'Web, saved 9 Oct 2026')
    assert.equal(cite.staleNote, undefined)
    assert.equal(cite.url, passage.url)

    const other = '44444444-4444-4444-8444-444444444444'
    chat(handle, other)
    assert.equal(searchSavedWeb(handle, 'What beacon code was posted for pier 9?', unitVec(0), other).decision, 'insufficient')
    assert.equal(searchSavedWeb(handle, 'What beacon code was posted for pier 9?', unitVec(0), null).top.length > 0, true)
    assert.equal(searchSavedWeb(handle, 'best pizza recipe', unitVec(1), conv).decision, 'insufficient')

    const stale = savedWebCitation(found.top[0], 'What is the price today?', passage.fetchedAt + 48 * 60 * 60 * 1000)
    assert.equal(stale.staleNote, STALE_NOTE)
    assert.equal(contentHash(passage.url, passage.text), contentHash(passage.url, passage.text))
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleting a chat drops its saved passages, and clear removes the rest', () => {
  const { dir, handle } = db()
  try {
    const a = '11111111-1111-4111-8111-111111111111'
    const b = '55555555-5555-4555-8555-555555555555'
    chat(handle, a)
    chat(handle, b)
    saveCitedPassages(handle, a, '22222222-2222-4222-8222-222222222222', [passage])
    saveCitedPassages(handle, b, '66666666-6666-4666-8666-666666666666', [passage])
    saveCitedPassages(handle, b, '77777777-7777-4777-8777-777777777777', [{
      ...passage,
      url: 'https://example.com/other',
      text: 'A second saved page about rope coils on shelf B7.',
      vec: unitVec(2),
    }])
    assert.equal(savedWebStats(handle).count, 2)
    new SessionStore(handle).remove(a)
    assert.equal(savedWebStats(handle).count, 2)
    new SessionStore(handle).remove(b)
    assert.equal(savedWebStats(handle).count, 0)
    assert.equal((handle.prepare('SELECT COUNT(*) AS n FROM web_passage_links').get() as { n: number }).n, 0)

    chat(handle, a)
    saveCitedPassages(handle, a, '22222222-2222-4222-8222-222222222222', [passage])
    clearSavedWeb(handle)
    const cleared = savedWebStats(handle)
    assert.equal(cleared.count, 0)
    assert.equal(cleared.bytes, 0)
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the size cap evicts the least recently used passage', () => {
  const { dir, handle } = db()
  try {
    const conv = '11111111-1111-4111-8111-111111111111'
    chat(handle, conv)
    const first = { ...passage, text: 'a'.repeat(20), url: 'https://example.com/a' }
    const second = { ...passage, text: 'b'.repeat(20), url: 'https://example.com/b' }
    saveCitedPassages(handle, conv, '22222222-2222-4222-8222-222222222222', [first], { now: 1_000, maxBytes: 30 })
    saveCitedPassages(handle, conv, '33333333-3333-4333-8333-333333333333', [second], { now: 2_000, maxBytes: 30 })
    const stats = savedWebStats(handle)
    assert.equal(stats.count, 1)
    assert.equal(stats.bytes, 20)
    const left = handle.prepare('SELECT url FROM web_passages').get() as { url: string }
    assert.equal(left.url, second.url)
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
