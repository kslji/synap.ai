import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { deviceIdHash } from './device-id.js'
import { loadLicenceDir, writeLicenceDir } from './licence-file.js'
import {
  canonicalLicence,
  derivePackKey,
  devBypassEnabled,
  gatePackDecrypt,
  inspectLicence,
  integrityHex,
  licenceAllowsUse,
  type LicencePayload,
  type StoredLicence,
} from './licence.js'

const PUBLIC = 'd04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737'
const SIGNATURE = 'vknWScp7375ebeF52/Y+gSTsJbyxS8xPvrkmaKiwWtgKr4VIKKVu0/iVwNvZ77TQRoWLlaqMRfGXLV8uSTS1CQ=='
const INTEGRITY = '3c9e3bc8e940231f326d13055b643b353ad7413640de7349dfcbbf327b7f954e'
const DEVICE = 'ab'.repeat(32)
const KEYS = { 'lic-test': PUBLIC }

const payload: LicencePayload = {
  account: '22222222-2222-4222-8222-222222222222',
  device_id_hash: DEVICE,
  expires_at: '2026-11-22T00:00:00Z',
  features: ['chat', 'packs'],
  issued_at: '2026-10-16T00:00:00Z',
  key_id: 'lic-test',
  licence_id: '11111111-1111-4111-8111-111111111111',
  plan: 'pro',
  refresh_by: '2026-11-15T00:00:00Z',
}

const stored: StoredLicence = { payload, signature: SIGNATURE, key_id: 'lic-test', integrity: INTEGRITY }
const during = Date.parse('2026-10-20T00:00:00Z')
const graceAt = Date.parse('2026-11-16T00:00:00Z')
const after = Date.parse('2026-11-23T00:00:00Z')

function check(over: Partial<Parameters<typeof inspectLicence>[0]>) {
  return inspectLicence({
    stored,
    broken: false,
    nowMs: during,
    deviceIdHash: DEVICE,
    publicKeys: KEYS,
    maxSeenMs: during,
    clockOk: true,
    devBypass: false,
    ...over,
  })
}

test('a PyNaCl signature verifies, and a forged payload does not', () => {
  assert.equal(canonicalLicence(payload).includes('"plan":"pro"'), true)
  assert.equal(integrityHex(payload, SIGNATURE), INTEGRITY)
  const ok = check({})
  assert.equal(ok.state, 'valid')
  assert.equal(licenceAllowsUse(ok.state), true)
  const tampered: LicencePayload = { ...payload, plan: 'fleet' }
  const forged = check({
    stored: { payload: tampered, signature: SIGNATURE, key_id: 'lic-test', integrity: integrityHex(tampered, SIGNATURE) },
  })
  assert.equal(forged.state, 'invalid')
  assert.equal(licenceAllowsUse(forged.state), false)
})

test('expiry, grace, device mismatch, and clock rollback', () => {
  assert.equal(check({ nowMs: graceAt, maxSeenMs: graceAt }).state, 'grace')
  assert.equal(check({ nowMs: after, maxSeenMs: after }).state, 'expired')
  assert.equal(check({ deviceIdHash: 'cd'.repeat(32) }).state, 'device_mismatch')
  assert.equal(check({ maxSeenMs: during + 24 * 60 * 60 * 1000 }).state, 'clock_rollback')
  assert.equal(check({ maxSeenMs: null, clockOk: false }).state, 'clock_rollback')
  assert.equal(check({ stored: null }).state, 'missing')
})

test('SYNAP_LICENCE_DEV is ignored on a packaged build', () => {
  assert.equal(devBypassEnabled('1', false), true)
  assert.equal(devBypassEnabled('1', true), false)
  assert.equal(devBypassEnabled(undefined, false), false)
  assert.equal(devBypassEnabled('0', false), false)
  const skipped = check({ devBypass: true, stored: null })
  assert.equal(skipped.state, 'dev')
  assert.equal(licenceAllowsUse(skipped.state), true)
  assert.equal(check({ devBypass: false, stored: null }).state, 'missing')
})

test('the pack stub stays locked without a licence and exposes a derived key with one', () => {
  const locked = gatePackDecrypt(true, { allowed: false, contentKey: null, encrypted: false })
  assert.equal(locked.status, 'locked')
  const key = derivePackKey(payload)
  assert.equal(key.length, 32)
  const open = gatePackDecrypt(true, { allowed: true, contentKey: key, encrypted: true })
  assert.equal(open.status, 'ready')
  if (open.status === 'ready') assert.equal(open.contentKey?.equals(key), true)
  const hook = gatePackDecrypt(true, { allowed: true, contentKey: null, encrypted: true })
  assert.equal(hook.status, 'locked')
  assert.equal(gatePackDecrypt(false, { allowed: false, contentKey: null, encrypted: false }).status, 'absent')
})

test('the licence file integrity fails closed when the clock file is dropped', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-licence-'))
  try {
    await writeLicenceDir(dir, stored, during)
    const loaded = await loadLicenceDir(dir)
    assert.equal(loaded.clockOk, true)
    const verdict = check({
      stored: loaded.stored,
      maxSeenMs: loaded.maxSeenMs,
      clockOk: loaded.clockOk,
      nowMs: during + 60_000,
    })
    assert.equal(verdict.state, 'valid')
    const { rm } = await import('node:fs/promises')
    await rm(join(dir, 'licence-clock.json'))
    const dropped = await loadLicenceDir(dir)
    assert.equal(dropped.clockOk, false)
    assert.equal(check({ stored: dropped.stored, maxSeenMs: dropped.maxSeenMs, clockOk: dropped.clockOk }).state, 'clock_rollback')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('device id is a hash of the identifiers and the app salt', () => {
  const hash = deviceIdHash(['platform:linux', 'machine:abc'])
  assert.equal(hash, deviceIdHash(['platform:linux', 'machine:abc']))
  assert.notEqual(hash, deviceIdHash(['platform:linux', 'machine:abd']))
  assert.equal(hash.includes('abc'), false)
  assert.equal(hash.length, 64)
  assert.throws(() => deviceIdHash(['  ']))
})
