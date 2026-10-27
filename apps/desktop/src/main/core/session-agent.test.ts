import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import { openUserDb } from './db.js'
import { LIBRARY_MIGRATION } from './library-schema.js'
import { SESSION_MIGRATION, SessionStore } from './session-store.js'

const KEY = 'ab'.repeat(32)

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('an existing chat keeps its agent and only replaces a placeholder title', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-agent-chat-'))
  const handle = openUserDb(join(dir, 'user.db'), KEY, [SESSION_MIGRATION, LIBRARY_MIGRATION])
  try {
    const store = new SessionStore(handle)
    const code = store.ensure(null, 'New Code chat', 'code')
    assert.equal(store.agentOf(code), 'code')
    store.ensure(code, 'Hello', 'general')
    assert.equal(store.agentOf(code), 'code')
    assert.equal(store.list().find((chat) => chat.id === code)?.title, 'Hello')
    store.append(code, { id: '11111111-1111-4111-8111-111111111111', role: 'user', text: 'Hello', sources: [] })
    store.ensure(code, 'A later line', 'assistant')
    assert.equal(store.agentOf(code), 'code')
    assert.equal(store.list().find((chat) => chat.id === code)?.title, 'Hello')

    const named = store.ensure(null, 'Harbor ferry', 'general')
    store.ensure(named, 'Something else', 'code')
    assert.equal(store.agentOf(named), 'general')
    assert.equal(store.list().find((chat) => chat.id === named)?.title, 'Harbor ferry')
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a memory chat also keeps the agent it was started with', () => {
  const store = new SessionStore(null)
  const id = store.ensure(null, 'New Assistant chat', 'assistant')
  store.ensure(id, 'Draft the note', 'general')
  assert.equal(store.agentOf(id), 'assistant')
  assert.equal(store.list()[0]?.title, 'Draft the note')
})
