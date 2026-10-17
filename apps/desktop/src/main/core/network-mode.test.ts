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

test('network mode defaults to Auto and keeps a legacy offline file offline', () => {
  assert.equal(cleanNetworkMode(undefined, false), 'auto')
  assert.equal(cleanNetworkMode(undefined, undefined), 'auto')
  assert.equal(cleanNetworkMode(undefined, true), 'offline')
  assert.equal(cleanNetworkMode('online', true), 'online')
  assert.equal(cleanNetworkMode('nope', false), 'auto')
})

test('a settings change picks the mode, and Offline still blocks when the computer is online', () => {
  assert.equal(resolveNetworkMode('auto', { networkMode: 'offline' }), 'offline')
  assert.equal(resolveNetworkMode('offline', { offlineOnly: false }), 'auto')
  assert.equal(resolveNetworkMode('online', { offlineOnly: false }), 'online')
  assert.equal(resolveNetworkMode('auto', { offlineOnly: true }), 'offline')
  assert.equal(blocksNetwork('offline', true), true)
  assert.equal(blocksNetwork('online', false), false)
  assert.equal(blocksNetwork('auto', false), true)
  assert.equal(blocksNetwork('auto', true), false)
})

test('an offline answer says it stayed on this computer, once', () => {
  const once = withLocalOnlyNote('The ferry leaves at 06:40.', true)
  assert.equal(once.includes(LOCAL_ONLY_NOTE), true)
  assert.equal(withLocalOnlyNote(once, true), once)
  assert.equal(withLocalOnlyNote('The ferry leaves at 06:40.', false).includes(LOCAL_ONLY_NOTE), false)
  const refusal = "I don't have enough information to answer that from the sources on this computer. Add a document. Turn on web search when you are online."
  assert.equal(withLocalOnlyNote(refusal, true), refusal)
})

test('the sync chip uses the four status labels and shows the mode', () => {
  const base = { packVersion: '2026.10.01', syncingVersion: null, lastSyncAt: NOW, refreshBy: null, now: NOW }
  const ready = syncChip({ ...base, mode: 'auto', osOnline: true, syncing: false, failed: false })
  assert.equal(ready.label, 'Up to date')
  assert.equal(ready.modeLabel, 'Auto')
  assert.equal(ready.tooltip.includes('Pack v2026.10.01'), true)
  assert.equal(ready.tooltip.includes('2026-10-16T12:00:00.000Z'), true)

  const syncing = syncChip({ ...base, mode: 'online', osOnline: true, syncing: true, failed: false, syncingVersion: '2026.10.09' })
  assert.equal(syncing.label, 'Syncing pack v2026.10.09')
  assert.equal(syncing.state, 'syncing')

  const unnamed = syncChip({ ...base, mode: 'online', osOnline: true, syncing: true, failed: false, packVersion: null, syncingVersion: null })
  assert.equal(unnamed.label, 'Syncing pack')

  const failed = syncChip({ ...base, mode: 'auto', osOnline: true, syncing: false, failed: true })
  assert.equal(failed.label, 'Sync failed, will retry')

  const offline = syncChip({ ...base, mode: 'offline', osOnline: true, syncing: true, failed: true })
  assert.equal(offline.label, 'Offline')
  assert.equal(offline.state, 'offline')

  const detected = syncChip({ ...base, mode: 'auto', osOnline: false, syncing: true, failed: false })
  assert.equal(detected.label, 'Offline')
  assert.equal(detected.mode, 'auto')

  const chosenOnline = syncChip({ ...base, mode: 'online', osOnline: false, syncing: false, failed: false })
  assert.equal(chosenOnline.label, 'Up to date')
  assert.equal(chosenOnline.modeLabel, 'Online')
})

test('Offline mode warns when the licence refresh is due, and Auto does not', () => {
  const soon = new Date(NOW + REFRESH_WARN_MS).toISOString()
  const later = new Date(NOW + REFRESH_WARN_MS + 86_400_000).toISOString()
  const past = new Date(NOW - 1000).toISOString()
  assert.match(licenceRefreshWarning({ mode: 'offline', refreshBy: soon, now: NOW }) ?? '', /soon/)
  assert.match(licenceRefreshWarning({ mode: 'offline', refreshBy: past, now: NOW }) ?? '', /passed/)
  assert.equal(licenceRefreshWarning({ mode: 'offline', refreshBy: later, now: NOW }), null)
  assert.equal(licenceRefreshWarning({ mode: 'auto', refreshBy: past, now: NOW }), null)
  assert.equal(licenceRefreshWarning({ mode: 'online', refreshBy: past, now: NOW }), null)
  const chip = syncChip({
    mode: 'offline', osOnline: true, syncing: false, failed: false,
    packVersion: null, syncingVersion: null, lastSyncAt: null, refreshBy: past, now: NOW,
  })
  assert.match(chip.tooltip, /passed/)
  assert.match(chip.refreshWarning ?? '', /passed/)
  assert.equal(chip.detail.includes('Last sync: not yet'), true)
  assert.equal(chip.showMode, true)
})

test('dev mode tells the chip that sync is off', () => {
  const chip = syncChip({
    mode: 'online', osOnline: true, syncing: true, failed: true,
    packVersion: '2026.10.01', syncingVersion: '2026.10.09', lastSyncAt: NOW, refreshBy: new Date(NOW).toISOString(), now: NOW,
    devMode: true,
  })
  assert.equal(chip.label, 'Dev mode, sync off')
  assert.equal(chip.state, 'offline')
  assert.equal(chip.mode, 'online')
  assert.equal(chip.showMode, false)
  assert.equal(chip.refreshWarning, null)
  assert.equal(chip.detail.includes('Last sync: not yet'), true)
})
