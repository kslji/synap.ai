import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blocksNetwork,
  cleanNetworkMode,
  licenceRefreshWarning,
  LOCAL_ONLY_NOTE,
  REFRESH_WARN_MS,
  resolveNetworkMode,
  syncChip,
  withLocalOnlyNote,
} from './network-mode.js'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')

test('the routing choice is Offline or Online only; legacy Auto settings land on Online', () => {
  assert.equal(cleanNetworkMode('offline', false), 'offline')
  assert.equal(cleanNetworkMode('online', true), 'online')
  // A settings file written before this change may say "auto" or nothing at all.
  assert.equal(cleanNetworkMode('auto', false), 'online')
  assert.equal(cleanNetworkMode(undefined, false), 'online')
  assert.equal(cleanNetworkMode(undefined, undefined), 'online')
  assert.equal(cleanNetworkMode('nope', false), 'online')
  // The legacy offlineOnly flag still means Offline.
  assert.equal(cleanNetworkMode(undefined, true), 'offline')
})

test('a settings change picks the mode, and Offline blocks whatever the computer is doing', () => {
  assert.equal(resolveNetworkMode('online', { networkMode: 'offline' }), 'offline')
  assert.equal(resolveNetworkMode('offline', { networkMode: 'online' }), 'online')
  assert.equal(resolveNetworkMode('online', { offlineOnly: true }), 'offline')
  assert.equal(resolveNetworkMode('offline', { offlineOnly: false }), 'online')
  assert.equal(resolveNetworkMode('online', {}), 'online')
  assert.equal(resolveNetworkMode('offline', {}), 'offline')
  // Offline makes no network calls, connection up or down.
  assert.equal(blocksNetwork('offline', true), true)
  assert.equal(blocksNetwork('offline', false), true)
  // Online attempts regardless of the connection detection that Auto used.
  assert.equal(blocksNetwork('online', false), false)
  assert.equal(blocksNetwork('online', true), false)
})

test('Offline blocks regardless of the connection; the IPC-boundary assertions live in main/core', () => {
  // The SettingsPatch zod assertions live in the main/core copy of this test
  // (src/main/core/network-mode.test.ts); the IPC schemas are main-process code.
  assert.equal(blocksNetwork('offline', true), true)
})

test('an offline answer says it stayed on this computer, once', () => {
  const once = withLocalOnlyNote('The ferry leaves at 06:40.', true)
  assert.equal(once.includes(LOCAL_ONLY_NOTE), true)
  assert.equal(withLocalOnlyNote(once, true), once)
  assert.equal(withLocalOnlyNote('The ferry leaves at 06:40.', false).includes(LOCAL_ONLY_NOTE), false)
  const refusal = "I don't have enough information to answer that from the sources on this computer. Add a document. Turn on web search when you are online."
  assert.equal(withLocalOnlyNote(refusal, true), refusal)
})

test('the sync chip shows Offline or Online only', () => {
  const base = { packVersion: '2026.10.01', syncingVersion: null, lastSyncAt: NOW, refreshBy: null, now: NOW }
  const ready = syncChip({ ...base, mode: 'online', osOnline: true, syncing: false, failed: false })
  assert.equal(ready.label, 'Up to date')
  assert.equal(ready.modeLabel, 'Online')
  assert.equal(ready.tooltip.includes('Pack v2026.10.01'), true)
  assert.equal(ready.tooltip.includes('2026-10-16T12:00:00.000Z'), true)

  const syncing = syncChip({ ...base, mode: 'online', osOnline: true, syncing: true, failed: false, syncingVersion: '2026.10.09' })
  assert.equal(syncing.label, 'Syncing pack v2026.10.09')
  assert.equal(syncing.state, 'syncing')

  const unnamed = syncChip({ ...base, mode: 'online', osOnline: true, syncing: true, failed: false, packVersion: null, syncingVersion: null })
  assert.equal(unnamed.label, 'Syncing pack')

  const failed = syncChip({ ...base, mode: 'online', osOnline: true, syncing: false, failed: true })
  assert.equal(failed.label, 'Sync failed, will retry')

  const offline = syncChip({ ...base, mode: 'offline', osOnline: true, syncing: true, failed: true })
  assert.equal(offline.label, 'Offline')
  assert.equal(offline.state, 'offline')
  assert.equal(offline.modeLabel, 'Offline')

  // Online no longer consults the connection the way Auto did: attempts continue.
  const noCable = syncChip({ ...base, mode: 'online', osOnline: false, syncing: false, failed: false })
  assert.equal(noCable.label, 'Up to date')
  assert.equal(noCable.state, 'uptodate')
})

test('Offline mode warns when the licence refresh is due, and Online does not', () => {
  const soon = new Date(NOW + REFRESH_WARN_MS).toISOString()
  const later = new Date(NOW + REFRESH_WARN_MS + 86_400_000).toISOString()
  const past = new Date(NOW - 1000).toISOString()
  assert.match(licenceRefreshWarning({ mode: 'offline', refreshBy: soon, now: NOW }) ?? '', /soon/)
  assert.match(licenceRefreshWarning({ mode: 'offline', refreshBy: past, now: NOW }) ?? '', /passed/)
  assert.equal(licenceRefreshWarning({ mode: 'offline', refreshBy: later, now: NOW }), null)
  assert.equal(licenceRefreshWarning({ mode: 'online', refreshBy: past, now: NOW }), null)
  // The copy must not point at a mode that no longer exists.
  assert.doesNotMatch(licenceRefreshWarning({ mode: 'offline', refreshBy: past, now: NOW }) ?? '', /Auto/)
  assert.doesNotMatch(licenceRefreshWarning({ mode: 'offline', refreshBy: soon, now: NOW }) ?? '', /Auto/)
  const chip = syncChip({
    mode: 'offline', osOnline: true, syncing: false, failed: false,
    packVersion: null, syncingVersion: null, lastSyncAt: null, refreshBy: past, now: NOW,
  })
  assert.match(chip.tooltip, /passed/)
  assert.match(chip.refreshWarning ?? '', /passed/)
  assert.equal(chip.detail.includes('Last sync: not yet'), true)
  assert.equal(chip.showMode, true)
})

test('dev mode follows the real sync state and does not invent a label', () => {
  const chip = syncChip({
    mode: 'online', osOnline: true, syncing: true, failed: true,
    packVersion: '2026.10.01', syncingVersion: '2026.10.09', lastSyncAt: NOW, refreshBy: new Date(NOW).toISOString(), now: NOW,
    devMode: true,
  })
  assert.equal(chip.label, 'Syncing pack v2026.10.09')
  assert.equal(chip.state, 'syncing')
  assert.equal(chip.mode, 'online')
  assert.equal(chip.showMode, true)
  assert.equal(chip.refreshWarning, null)
  assert.doesNotMatch(`${chip.label} ${chip.detail} ${chip.tooltip}`, /Dev mode/)
  const offline = syncChip({
    mode: 'offline', osOnline: true, syncing: false, failed: true,
    packVersion: null, syncingVersion: null, lastSyncAt: null, refreshBy: new Date(NOW - 1000).toISOString(), now: NOW,
    devMode: true,
  })
  assert.equal(offline.label, 'Offline')
  assert.equal(offline.state, 'offline')
  assert.equal(offline.refreshWarning, null)
  assert.equal(offline.detail.includes('Last sync: not yet'), true)
  assert.doesNotMatch(`${offline.label} ${offline.detail}`, /Dev mode/)
})
