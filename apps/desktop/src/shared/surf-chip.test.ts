import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { syncChip } from '../main/core/network-mode.js'
import {
  SURF_CHIP_DARK,
  SURF_CHIP_IDLE,
  SURF_CHIP_LIGHT,
  SURF_FAIL_BG_DARK,
  SURF_FAIL_BG_LIGHT,
  SURF_FAIL_INK_DARK,
  SURF_FAIL_INK_LIGHT,
  SURF_MUTED_DARK,
  SURF_MUTED_LIGHT,
  SURF_OK_BG,
  SURF_OK_INK,
  SURF_SYNC_INK,
  SURF_SYNC_ORANGE,
  SYNCED_HOLD_MS,
  contrastRatio,
  surfChipStep,
  surfChipText,
  surfChipTone,
} from './surf-chip.js'

const NOW = Date.parse('2026-10-17T12:00:00.000Z')

test('the Surf chip is idle, orange while syncing, then Synced, then Surf again', () => {
  assert.deepEqual(surfChipStep(SURF_CHIP_IDLE, 'uptodate', NOW), SURF_CHIP_IDLE)
  assert.equal(surfChipText('idle'), 'Surf')

  const syncing = surfChipStep(SURF_CHIP_IDLE, 'syncing', NOW)
  assert.equal(syncing.phase, 'syncing')
  assert.equal(surfChipText(syncing.phase), 'Surf')

  const synced = surfChipStep(syncing, 'uptodate', NOW)
  assert.equal(synced.phase, 'synced')
  assert.equal(synced.holdUntil, NOW + SYNCED_HOLD_MS)
  assert.equal(surfChipText(synced.phase), 'Surf · Synced')
  assert.equal(surfChipStep(synced, 'uptodate', NOW + 1000).phase, 'synced')

  const idle = surfChipStep(synced, 'uptodate', NOW + SYNCED_HOLD_MS)
  assert.equal(idle.phase, 'idle')
  assert.equal(surfChipText(idle.phase), 'Surf')
  assert.equal(surfChipText('idle', 'Harbor'), 'Harbor')
  assert.equal(surfChipText('syncing', 'Harbor'), 'Harbor')
  assert.equal(surfChipText('synced', '  Harbor  '), 'Harbor · Synced')
  assert.equal(surfChipText('failed', 'Harbor'), 'Sync failed')
  assert.equal(surfChipText('offline', 'Harbor'), 'Offline')
  assert.equal(surfChipText('idle', '   '), 'Surf')
  assert.equal(surfChipText('synced', 'N'.repeat(40)), `${'N'.repeat(32)} · Synced`)
})

test('a failed or offline sync is not shown as Synced', () => {
  const syncing = surfChipStep(SURF_CHIP_IDLE, 'syncing', NOW)
  const failed = surfChipStep(syncing, 'failed', NOW)
  assert.equal(failed.phase, 'failed')
  assert.equal(surfChipText(failed.phase), 'Sync failed')
  const offline = surfChipStep(syncing, 'offline', NOW)
  assert.equal(offline.phase, 'offline')
  assert.equal(surfChipText(offline.phase), 'Offline')
  const held = surfChipStep(SURF_CHIP_IDLE, 'syncing', NOW)
  const celebrated = surfChipStep(held, 'uptodate', NOW)
  assert.equal(surfChipStep(celebrated, 'offline', NOW).phase, 'offline')
  assert.equal(surfChipStep(celebrated, 'failed', NOW).phase, 'failed')
})

test('chip colours clear WCAG AA in light and dark', () => {
  assert.ok(contrastRatio(SURF_SYNC_INK, SURF_SYNC_ORANGE) >= 4.5)
  assert.ok(contrastRatio(SURF_OK_INK, SURF_OK_BG) >= 4.5)
  assert.ok(contrastRatio(SURF_FAIL_INK_LIGHT, SURF_FAIL_BG_LIGHT) >= 4.5)
  assert.ok(contrastRatio(SURF_FAIL_INK_DARK, SURF_FAIL_BG_DARK) >= 4.5)
  assert.ok(contrastRatio(SURF_MUTED_LIGHT, SURF_CHIP_LIGHT) >= 4.5)
  assert.ok(contrastRatio(SURF_MUTED_DARK, SURF_CHIP_DARK) >= 4.5)
  assert.equal(surfChipTone('idle', 'light'), null)
  assert.equal(surfChipTone('offline', 'dark'), null)
  assert.equal(surfChipTone('syncing', 'dark')?.background, SURF_SYNC_ORANGE)
  assert.equal(surfChipTone('syncing', 'light')?.color, SURF_SYNC_INK)
  assert.equal(surfChipTone('synced', 'dark')?.background, SURF_OK_BG)
  assert.equal(surfChipTone('failed', 'light')?.color, SURF_FAIL_INK_LIGHT)
  assert.equal(surfChipTone('failed', 'dark')?.color, SURF_FAIL_INK_DARK)
})

test('the syncing pulse is visual only and stays still when motion is reduced', () => {
  const css = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8')
  assert.match(css, /@keyframes surf-chip-pulse/)
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.surf-chip\.is-syncing \{ animation: none; \}/)
  assert.doesNotMatch(css, /surf-chip[\s\S]{0,400}audio/i)
})

test('dev mode does not invent a sync label', () => {
  const now = NOW
  const base = { packVersion: null, syncingVersion: null, lastSyncAt: null, refreshBy: new Date(now).toISOString(), now, devMode: true as const }
  const idle = syncChip({ ...base, mode: 'online', osOnline: true, syncing: false, failed: false })
  assert.equal(idle.label, 'Up to date')
  assert.equal(idle.state, 'uptodate')
  assert.equal(idle.refreshWarning, null)
  assert.doesNotMatch(`${idle.label} ${idle.detail}`, /Dev mode/)
  const offline = syncChip({ ...base, mode: 'offline', osOnline: true, syncing: true, failed: true })
  assert.equal(offline.state, 'offline')
  assert.equal(offline.label, 'Offline')
})
