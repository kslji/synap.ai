import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import { openUserDb } from './db.js'
import { LIBRARY_MIGRATION } from './library-schema.js'
import { nextReplyVersions, regenerateReply } from './reply-versions.js'
import { SESSION_MIGRATION, SessionStore } from './session-store.js'
import { includeScreenshotCache, screenshotBelongsInCache } from './live/storage.js'

const KEY = 'ab'.repeat(32)
const USER = '11111111-1111-4111-8111-111111111111'
const ASST = '22222222-2222-4222-8222-222222222222'

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('sibling versions append and do not duplicate the latest text', () => {
  assert.deepEqual(nextReplyVersions([], '', 'One'), ['One'])
  assert.deepEqual(nextReplyVersions(['One'], 'One', 'Two'), ['One', 'Two'])
  assert.deepEqual(nextReplyVersions(['One', 'Two'], 'Two', 'Two'), ['One', 'Two'])
  const turns = regenerateReply([
    { id: USER, role: 'user', text: 'Hello', versions: [] },
    { id: ASST, role: 'assistant', text: 'One', versions: ['One'] },
  ], ASST, 'Two')
  assert.equal(turns.length, 2)
  assert.equal(turns.filter((turn) => turn.role === 'user').length, 1)
  assert.equal(turns[0]?.text, 'Hello')
  assert.deepEqual(turns[1]?.versions, ['One', 'Two'])
  assert.equal(turns[1]?.id, ASST)
})

test('a saved reply keeps versions on the same row and does not add a user turn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-versions-'))
  const handle = openUserDb(join(dir, 'user.db'), KEY, [SESSION_MIGRATION, LIBRARY_MIGRATION])
  try {
    const store = new SessionStore(handle)
    const cid = store.ensure(null, 'Hello', 'general')
    store.append(cid, { id: USER, role: 'user', text: 'Hello', sources: [] })
    store.saveReply(cid, { id: ASST, role: 'assistant', text: 'One', sources: [], gate: 'answer', versions: nextReplyVersions([], '', 'One') })
    store.saveReply(cid, { id: ASST, role: 'assistant', text: 'Two', sources: [], gate: 'answer', versions: nextReplyVersions(['One'], 'One', 'Two') })
    const opened = store.open(cid)
    assert.equal(opened.messages.length, 2)
    assert.equal(opened.messages.filter((message) => message.role === 'user').length, 1)
    assert.equal(opened.messages[1]?.id, ASST)
    assert.equal(opened.messages[1]?.text, 'Two')
    assert.deepEqual(opened.messages[1]?.versions, ['One', 'Two'])
    const again = new SessionStore(handle).readMessage(ASST)
    assert.equal(again?.conversationId, cid)
    assert.deepEqual(again?.versions, ['One', 'Two'])
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a memory session also keeps regenerate on the same assistant reply', () => {
  const store = new SessionStore(null)
  const cid = store.ensure(null, 'Hello', 'general')
  store.append(cid, { id: USER, role: 'user', text: 'Hello', sources: [] })
  store.saveReply(cid, { id: ASST, role: 'assistant', text: 'One', sources: [], versions: ['One'] })
  store.saveReply(cid, { id: ASST, role: 'assistant', text: 'Two', sources: [], versions: ['One', 'Two'] })
  const opened = store.open(cid)
  assert.equal(opened.messages.length, 2)
  assert.deepEqual(opened.messages[1]?.versions, ['One', 'Two'])
})

test('screenshots saved through the Save dialog stay out of the cache', () => {
  assert.equal(includeScreenshotCache(0), false)
  assert.equal(includeScreenshotCache(2), true)
  assert.equal(screenshotBelongsInCache('/home/ada/Pictures/shot.png', '/home/ada/.config/surf-ai'), false)
  assert.equal(screenshotBelongsInCache('/home/ada/.config/surf-ai/screenshots/shot.png', '/home/ada/.config/surf-ai'), true)
})
