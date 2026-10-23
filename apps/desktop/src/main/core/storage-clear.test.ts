import assert from 'node:assert/strict'
import { test } from 'node:test'
import { storageClearAllowed } from './live/storage.js'

test('clearing cache does not remove models or chats', () => {
  assert.equal(storageClearAllowed('models'), false)
  assert.equal(storageClearAllowed('chats'), false)
  assert.equal(storageClearAllowed('logs'), true)
  assert.equal(storageClearAllowed('packs'), true)
  assert.equal(storageClearAllowed('indexes'), true)
  assert.equal(storageClearAllowed('shots'), true)
})
