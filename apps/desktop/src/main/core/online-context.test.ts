/**
 * Item 12: an Online sub-chat may use this chat's Offline turns as context only
 * after the user consents, for that chat.
 *
 * The rule is per message, not per turn: anything whose own mode is 'online' has
 * already left the device, so re-sending it is not a new disclosure. An 'offline'
 * row (and a row written before mode existed, which the store treats as offline)
 * only goes once the chat has consented. Note rows are product chrome and never
 * become model context.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import { ONLINE_CONSENT_ON_NOTE, ONLINE_CONTEXT_LIMIT, onlineContextTurns, renderOnlineContext } from './online-context.js'
import { openUserDb } from './db.js'
import { LIBRARY_MIGRATION } from './library-schema.js'
import { SESSION_MIGRATION, SessionStore } from './session-store.js'

const CORE = dirname(fileURLToPath(import.meta.url))

function row(role: 'user' | 'assistant' | 'note', text: string, mode?: 'offline' | 'online') {
  return { id: text, role, text, mode }
}

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('without consent an online turn carries nothing that stayed offline', () => {
  const rows = [
    row('user', 'q1', 'offline'),
    row('assistant', 'a1', 'offline'),
    row('user', 'q2', 'online'),
    row('assistant', 'a2', 'online'),
  ]
  const carried = onlineContextTurns(rows, false)
  assert.deepEqual(carried.map((r) => r.text), ['q2', 'a2'], 'only rows that already went online may be reused')
  assert.equal(carried.some((r) => r.mode === 'offline'), false, 'no offline text may leave the device without consent')
})

test('a row with no mode is treated as offline', () => {
  // Older stored messages predate the mode column and are read as offline.
  const rows = [row('user', 'old'), row('assistant', 'older reply'), row('user', 'cloud', 'online')]
  assert.deepEqual(onlineContextTurns(rows, false).map((r) => r.text), ['cloud'])
})

test('consent lets the earlier offline turns through, oldest to newest', () => {
  const rows = [
    row('user', 'q1', 'offline'),
    row('assistant', 'a1', 'offline'),
    row('user', 'q2', 'online'),
    row('assistant', 'a2', 'online'),
  ]
  assert.deepEqual(onlineContextTurns(rows, true).map((r) => r.text), ['q1', 'a1', 'q2', 'a2'])
})

test('note rows are never context, with consent or without', () => {
  const rows = [
    row('note', 'Online may now use this chat’s Offline replies.'),
    row('user', 'q1', 'offline'),
    row('assistant', 'a1', 'offline'),
    row('note', 'Another note'),
  ]
  assert.equal(onlineContextTurns(rows, false).length, 0)
  assert.deepEqual(onlineContextTurns(rows, true).map((r) => r.text), ['q1', 'a1'])
})

test('the carried context is capped at the most recent rows', () => {
  const rows = Array.from({ length: ONLINE_CONTEXT_LIMIT + 8 }, (_, i) =>
    row(i % 2 === 0 ? 'user' : 'assistant', `m${i}`, 'offline'),
  )
  const carried = onlineContextTurns(rows, true)
  assert.equal(carried.length, ONLINE_CONTEXT_LIMIT, 'a bounded tail, not the whole thread')
  assert.equal(carried[carried.length - 1].text, `m${rows.length - 1}`, 'the newest turn is kept')
  assert.equal(carried[0].text, `m${rows.length - ONLINE_CONTEXT_LIMIT}`)
})

test('the rendered block says where each line came from', () => {
  assert.equal(renderOnlineContext([]), '', 'nothing to render when the chat has no reusable history')
  const gated = renderOnlineContext([row('user', 'q1', 'offline'), row('assistant', 'a1', 'offline')])
  assert.match(gated, /OFFLINE/, 'every line is labelled with the mode that produced it')
  assert.match(gated, /Offline context included because you allowed it for this chat/, 'the block says why it is here')
  const unconsented = renderOnlineContext([row('user', 'q2', 'online'), row('assistant', 'a2', 'online')])
  assert.match(unconsented, /ONLINE/)
  assert.equal(
    unconsented.includes('you allowed it'),
    false,
    'without consent the block must not claim consent',
  )
})

test('a message pinned by hand is not sent twice', () => {
  // The pinned block already carries it; the consent-gated history must skip it.
  const rows = [
    { ...row('user', 'q1', 'offline'), id: 'm1' },
    { ...row('assistant', 'a1', 'offline'), id: 'm2' },
  ]
  const carried = onlineContextTurns(rows, true, ['m1'])
  assert.deepEqual(carried.map((r) => r.id), ['m2'])
})

// --- the thread stores the note -----------------------------------------------------

test('a consent note is chrome: not the chat preview, not the search index', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-consent-note-'))
  const handle = openUserDb(join(dir, 'user.db'), 'ab'.repeat(32), [SESSION_MIGRATION, LIBRARY_MIGRATION])
  try {
    const store = new SessionStore(handle)
    const id = store.ensure(null, 'Harbor ferry', 'general')
    store.append(id, { id: '11111111-1111-4111-8111-111111111111', role: 'user', text: 'When does the ferry leave?', sources: [], mode: 'offline' })
    store.append(id, { id: '22222222-2222-4222-8222-222222222222', role: 'assistant', text: 'At 06:40.', sources: [], mode: 'offline' })
    store.append(id, { id: '33333333-3333-4333-8333-333333333333', role: 'note', text: ONLINE_CONSENT_ON_NOTE, sources: [] })
    const row = store.list().find((chat) => chat.id === id)
    assert.equal(row?.preview, 'At 06:40.', 'the chat list still previews the last real reply')
    assert.equal(store.searchMessages('composer').length, 0, 'the note is not searchable as if it were the user\'s words')
    // ...but it is still part of the thread when the chat is opened.
    assert.equal(store.open(id).messages.filter((message) => message.role === 'note').length, 1)
    const thread = store.open(id).messages
    assert.deepEqual(thread.map((message) => message.role), ['user', 'assistant', 'note'], 'the thread reads oldest to newest even when a whole turn lands in one millisecond')
  } finally {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

// --- wiring -------------------------------------------------------------------------

function read(rel: string): string {
  const path = resolve(CORE, rel)
  assert.equal(existsSync(path), true, `${rel} must exist`)
  return readFileSync(path, 'utf8')
}

test('the consent channels exist end to end', () => {
  const contract = read('../../shared/ipc-contract.ts')
  assert.match(contract, /chatConsentGet: 'chat:consent-get'/, 'the contract needs a get channel')
  assert.match(contract, /chatConsentSet: 'chat:consent-set'/, 'the contract needs a set channel')
  assert.match(contract, /getConsent\(.*\): Promise<ChatConsentState>/, 'the api must expose the state')
  assert.match(contract, /setConsent\(.*\): Promise<ChatConsentState>/, 'the api must expose the change')
  assert.match(read('./ipc-schemas.ts'), /ChatConsentGet = z\.object\(\{ conversationId: ConversationId \}\)/, 'the get request is validated')
  assert.match(read('./ipc-schemas.ts'), /ChatConsentSet = z\.object\(\{/, 'the set request is validated')
  const window = read('main-window.ts')
  assert.match(window, /handle\(IPC\.chatConsentGet, \(e, raw\) => \{ assertTrusted\(e\)/, 'the handler is trusted like every other channel')
  assert.match(window, /handle\(IPC\.chatConsentSet, \(e, raw\) => \{ assertTrusted\(e\)/)
  assert.match(read('../../preload/index.ts'), /ipcRenderer\.invoke\(IPC\.chatConsentGet/, 'preload exposes the get')
  assert.match(read('../../preload/index.ts'), /ipcRenderer\.invoke\(IPC\.chatConsentSet/, 'preload exposes the set')
})

test('the stored message can carry a thread note', () => {
  assert.match(
    read('../../shared/ipc-contract.ts'),
    /role: 'user' \| 'assistant' \| 'note'/,
    'StoredMessage must allow a note row',
  )
  assert.match(
    read('../../renderer/src/types.ts'),
    /role: 'user' \| 'assistant' \| 'note'/,
    'UiMsg must allow it too, or the note never reaches the thread',
  )
  // The note text travels back on the state so the open thread can show it at once.
  assert.match(read('../../shared/ipc-contract.ts'), /interface ChatConsentState \{[\s\S]*?note: string[\s\S]*?\}/)
})

test('the online sub-chat asks for consent instead of assuming it', () => {
  const screen = read('../../renderer/src/screens/ChatScreen.tsx')
  // The chip only exists in Online mode on a saved chat - Offline has nothing to
  // consent to, and a chat with no stored thread has no Offline replies yet.
  assert.match(screen, /\{mode === 'online' && onlineConsent !== null && \([\s\S]*?data-online-consent=/, 'the chip renders only for the online sub-chat')
  assert.match(screen, /data-online-consent=\{onlineConsent \? 'on' : 'off'\}/, 'the chip shows the current state')
  assert.match(screen, /role="dialog"[\s\S]*?data-consent-cancel[\s\S]*?data-consent-accept/, 'agreeing happens in a dialog, not on a bare click')
  assert.match(screen, /onOnlineConsent\(true\)/, 'accepting grants consent for this chat')
  assert.match(screen, /onOnlineConsent\(false\)/, 'the same chip takes it back')
  // Consent is per chat, so a chat that has not been saved yet cannot be asked for it.
  assert.match(screen, /onlineConsent: boolean \| null/, 'null means this chat has no consent to give yet')
})

test('every message keeps a clear Online or Offline label', () => {
  const screen = read('../../renderer/src/screens/ChatScreen.tsx')
  const badges = screen.match(/data-mode-badge=\{msg\.mode \?\? 'offline'\}/g) ?? []
  assert.equal(badges.length, 2, 'the question and the answer each carry the mode that produced them')
  assert.match(screen, /data-consent-note="yes"/, 'the consent note renders as its own centred row')
})

test('the renderer reads consent when a chat opens and writes it from the chip', () => {
  const app = read('../../renderer/src/App.tsx')
  assert.match(app, /api\.chat\.getConsent\(conversationId\)/, 'opening a chat reads that chat\'s flag')
  assert.match(app, /api\.chat\.setConsent\(\{ conversationId, allowed \}\)/, 'the chip writes it back')
  assert.match(app, /onlineConsent=\{/, 'the chip is fed from the main process, not local state')
  assert.match(app, /onOnlineConsent=\{/, 'and reacting to it goes through ipc')
})

test('the main process gates the online history and notes the thread', () => {
  const services = read('app-services.ts')
  // The online turn goes through the gate in this module rather than shipping the thread.
  assert.match(services, /onlineContextTurns\(\n      priorMessages\(conversationId, userMessageId, messageId\)/, 'the online turn reads its own history through the gate')
  assert.match(services, /onlineContextAllowed\(readOnlineConsent\(codeAgentDir\(\)\), conversationId\)/, 'the flag is read per chat, on device')
  // Agreeing is recorded in the thread, and the note never becomes model context.
  assert.match(services, /role: 'note'/, 'giving or taking back consent writes a note row')
  assert.match(services, /req\.allowed \? ONLINE_CONSENT_ON_NOTE : ONLINE_CONSENT_OFF_NOTE/)
  const gated = services.match(/conversationTurnRows\(priorMessages\(/g) ?? []
  assert.equal(gated.length, 2, 'both local history loops drop note rows before pairing turns')
})
