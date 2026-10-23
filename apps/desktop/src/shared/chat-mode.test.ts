/**
 * Item 9: ChatMode is one definition, in the contract, with two values.
 *
 * App.tsx, ChatScreen.tsx and renderer/src/types.ts import the type from
 * shared/ipc-contract.ts, and it is defined there, so the import is not broken.
 * This test pins the shape instead: it fails if the export disappears, if a
 * third mode creeps back in (the 'auto' routing mode was removed in item 6), or
 * if a screen redeclares its own ChatMode and the two drift apart.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SHARED = dirname(fileURLToPath(import.meta.url))

function read(rel: string): string {
  const path = join(SHARED, rel)
  assert.equal(existsSync(path), true, `${rel} must exist`)
  return readFileSync(path, 'utf8')
}

test('the contract exports ChatMode as offline or online', () => {
  const src = read('ipc-contract.ts')
  const declaration = /export type ChatMode = ([^;\n]+)/.exec(src)
  assert.ok(declaration, 'shared/ipc-contract.ts must export ChatMode')
  const members = declaration[1].split('|').map((part) => part.trim().replace(/'/g, ''))
  assert.deepEqual(members.slice().sort(), ['offline', 'online'], `ChatMode must be exactly offline | online, got ${declaration[1]}`)
})

test('the screens use the contract type instead of a local copy', () => {
  for (const rel of ['../renderer/src/App.tsx', '../renderer/src/screens/ChatScreen.tsx', '../renderer/src/types.ts']) {
    const src = read(rel)
    assert.match(src, /import type \{[^}]*\bChatMode\b[^}]*\} from '[^']*shared\/ipc-contract'/, `${rel} must import ChatMode from the contract`)
    assert.equal(/(export )?type ChatMode =/.test(src), false, `${rel} must not redeclare ChatMode`)
  }
  // The removed routing mode must not come back through this type.
  assert.equal(/type ChatMode = [^;\n]*auto/.test(read('ipc-contract.ts')), false, "'auto' must not return as a ChatMode")
})
