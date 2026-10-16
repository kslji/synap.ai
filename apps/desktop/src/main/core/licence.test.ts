import assert from 'node:assert/strict'
import { createPrivateKey, sign as edSign } from 'node:crypto'
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
  SUBSCRIPTION_WARN_MS,
  subscriptionWarns,
  type LicencePayload,
  type StoredLicence,
} from './licence.js'

const PUBLIC = 'd04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737'
const SIGNATURE = 'cGYSMlWnXqIz0rwHOMYQqWKJ6JgS4ro6SMk3zWu2IYDpCLFMEGD2WwtNBWncC48ehxrBih9dBah3K6F2zaUUAg=='
const INTEGRITY = 'fcbf72d172f8fc984bd8595100e889c79bcfe8b0bcec7df2d123d7a2821a4a7c'
const DEVICE = 'ab'.repeat(32)
const KEYS = { 'lic-test': PUBLIC }
const DAY = 24 * 60 * 60 * 1000

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
  subscription_ends_at: '2027-04-16T00:00:00Z',
  term_months: 6,
}

function signPayload(next: LicencePayload): StoredLicence {
  const pkcs8 = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.alloc(32, 0x11),
  ])
  const key = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  const signature = edSign(null, Buffer.from(canonicalLicence(next)), key).toString('base64')
  return { payload: next, signature, key_id: 'lic-test', integrity: integrityHex(next, signature) }
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

test('a passed subscription end locks offline, and rolling the clock back does not extend it', () => {
  const endedAt = '2026-11-10T00:00:00Z'
  const ended = signPayload({ ...payload, subscription_ends_at: endedAt })
  const seen = Date.parse('2026-11-16T00:00:00Z')
  const locked = check({ stored: ended, nowMs: seen, maxSeenMs: seen })
  assert.equal(locked.state, 'subscription_ended')
  assert.equal(licenceAllowsUse(locked.state), false)
  assert.equal(locked.payload?.subscription_ends_at, endedAt)
  assert.equal(locked.nextMaxSeenMs, seen)
  const rolled = check({ stored: ended, nowMs: Date.parse('2026-11-01T00:00:00Z'), maxSeenMs: seen })
  assert.equal(rolled.state, 'clock_rollback')
  assert.equal(licenceAllowsUse(rolled.state), false)
  const insideGrace = check({
    stored: signPayload({ ...payload, subscription_ends_at: '2026-11-16T00:00:00Z' }),
    nowMs: Date.parse('2026-11-16T12:00:00Z'),
    maxSeenMs: Date.parse('2026-11-16T12:00:00Z'),
  })
  assert.equal(insideGrace.state, 'subscription_ended')
})

test('the warning is on for the 7 days before the subscription ends', () => {
  const ends = Date.parse(payload.subscription_ends_at)
  assert.equal(subscriptionWarns(ends - SUBSCRIPTION_WARN_MS, ends, 'valid'), true)
  assert.equal(subscriptionWarns(ends - SUBSCRIPTION_WARN_MS - DAY, ends, 'valid'), false)
  assert.equal(subscriptionWarns(ends, ends, 'valid'), true)
  assert.equal(subscriptionWarns(ends - DAY, ends, 'subscription_ended'), false)
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
