/**
 * Item 7, the part that needs a real database. SessionStore.remove() used to
 * lean on web-cache's forgetConversation for the message and conversation
 * deletes, and clearHistory() deleted from the web passage table. Both tables
 * are gone, so the store must own every delete itself.
 *
 * This file is in `npm run test:unit`. It needs a better-sqlite3-multiple-ciphers
 * built for the Node ABI (what CI installs); the Electron build in a developer
 * checkout segfaults when opened from plain node.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { openUserDb } from './db.js'
import { LIBRARY_MIGRATION } from './library-schema.js'
import { SESSION_MIGRATION, SessionStore } from './session-store.js'

test('deleting a chat still clears it now that web-cache is gone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-web-purge-'))
  const handle = openUserDb(join(dir, 'user.db'), 'ab'.repeat(32), [SESSION_MIGRATION, LIBRARY_MIGRATION])
  try {
    const store = new SessionStore(handle)
    const id = store.ensure(null, 'Delete me', 'general')
    store.append(id, { id: '11111111-1111-4111-8111-111111111111', role: 'user', text: 'hello there', sources: [] })
    store.remove(id)
    assert.equal(store.list().some((chat) => chat.id === id), false)
    const left = handle.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(id) as { n: number }
    assert.equal(left.n, 0)
    // Clearing the whole history must not touch the deleted web tables either.
    const other = store.ensure(null, 'Kept for now', 'general')
    store.append(other, { id: '22222222-2222-4222-8222-222222222222', role: 'user', text: 'second chat', sources: [] })
    store.clearHistory()
    assert.deepEqual(store.list(), [])
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
