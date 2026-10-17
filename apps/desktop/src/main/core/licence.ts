/**
 * Offline licence checks. The API signs the payload with Ed25519. This module
 * checks that signature with the public key shipped in the app. A changed
 * file, a different computer, an expired grace period, or a clock set
 * backwards fails closed.
 *
 * This is basic tamper resistance. It does not make the app impossible to modify.
 */
import { createHash, verify as edVerify } from 'node:crypto'
import { z } from 'zod'
import { ed25519PublicKey } from './pack-verify.js'

export const BUY_URL = 'https://synap.surf/buy'

export const LicencePayload = z.object({
  account: z.string().uuid(),
  device_id_hash: z.string().regex(/^[0-9a-f]{64}$/),
  expires_at: z.string().min(20),
  features: z.array(z.string().min(1).max(64)).max(32),
  issued_at: z.string().min(20),
  key_id: z.string().min(1).max(64),
  licence_id: z.string().uuid(),
  plan: z.string().min(1).max(32),
  refresh_by: z.string().min(20),
  subscription_ends_at: z.string().min(20),
  term_months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
})
export type LicencePayload = z.infer<typeof LicencePayload>

export interface StoredLicence {
  payload: LicencePayload
  signature: string
  key_id: string
  integrity: string
}

export type LicenceState = 'valid' | 'grace' | 'missing' | 'invalid' | 'expired' | 'subscription_ended' | 'device_mismatch' | 'clock_rollback' | 'dev'

export const TERM_MONTHS = [1, 3, 6, 12] as const
export const SUBSCRIPTION_WARN_MS = 7 * 24 * 60 * 60 * 1000

export interface LicenceVerdict {
  state: LicenceState
  message: string
  payload: LicencePayload | null
  /** Written back when the verdict still allows use. */
  nextMaxSeenMs: number | null
}

export const CLOCK_SKEW_MS = 5 * 60 * 1000

export function canonicalLicence(payload: LicencePayload): string {
  const ordered = {
    account: payload.account,
    device_id_hash: payload.device_id_hash,
    expires_at: payload.expires_at,
    features: [...payload.features].map(String).sort(),
    issued_at: payload.issued_at,
    key_id: payload.key_id,
    licence_id: payload.licence_id,
    plan: payload.plan,
    refresh_by: payload.refresh_by,
    subscription_ends_at: payload.subscription_ends_at,
    term_months: payload.term_months,
  }
  return JSON.stringify(ordered)
}

export function integrityHex(payload: LicencePayload, signatureB64: string): string {
  return createHash('sha256').update(canonicalLicence(payload)).update('\n').update(signatureB64).digest('hex')
}

export function clockIntegrity(maxSeenMs: number, licenceIntegrity: string): string {
  return createHash('sha256').update(`${maxSeenMs}\n${licenceIntegrity}`).digest('hex')
}

export function signatureOk(payload: LicencePayload, signatureB64: string, publicHex: string): boolean {
  try {
    const sig = Buffer.from(signatureB64, 'base64')
    if (sig.length !== 64) return false
    return edVerify(null, Buffer.from(canonicalLicence(payload)), ed25519PublicKey(publicHex), sig)
  } catch {
    return false
  }
}

/**
 * Unpackaged builds may set SYNAP_LICENCE_DEV=1. Packaged builds ignore that flag.
 * The default switch is dev mode (`dev-mode.ts`): on until `release` is set, including installers.
 */
export function devBypassEnabled(flag: string | undefined, packaged: boolean): boolean {
  return flag === '1' && packaged === false
}

export function licenceAllowsUse(state: LicenceState): boolean {
  return state === 'valid' || state === 'grace' || state === 'dev'
}

/** True in the 7 days before subscription_ends_at. The end itself still locks, with no grace past it. */
export function subscriptionWarns(nowMs: number, endsMs: number, state: LicenceState): boolean {
  if (state !== 'valid' && state !== 'grace') return false
  const left = endsMs - nowMs
  return left >= 0 && left <= SUBSCRIPTION_WARN_MS
}

export function judgeWindow(nowMs: number, refreshByMs: number, expiresMs: number): 'ok' | 'grace' | 'expired' {
  if (nowMs > expiresMs) return 'expired'
  if (nowMs > refreshByMs) return 'grace'
  return 'ok'
}

function day(iso: string): string {
  return iso.slice(0, 10)
}

export function inspectLicence(input: {
  stored: StoredLicence | null
  broken: boolean
  nowMs: number
  deviceIdHash: string
  publicKeys: Record<string, string>
  maxSeenMs: number | null
  clockOk: boolean
  devBypass: boolean
}): LicenceVerdict {
  if (input.devBypass) {
    return {
      state: 'dev',
      message: 'Dev mode: the licence screen is off. Set SYNAP_DEV_MODE=0, or set "release": true in release-mode.json, to require a licence again.',
      payload: null,
      nextMaxSeenMs: null,
    }
  }
  if (input.broken) {
    return { state: 'invalid', message: 'This licence file is not valid.', payload: null, nextMaxSeenMs: null }
  }
  if (!input.stored) {
    return {
      state: 'missing',
      message: 'Synap.surf needs a licence on this computer. Sign in with the account that bought it, or enter a licence key.',
      payload: null,
      nextMaxSeenMs: null,
    }
  }
  const stored = input.stored
  const parsed = LicencePayload.safeParse(stored.payload)
  if (!parsed.success || stored.integrity !== integrityHex(parsed.data, stored.signature)) {
    return { state: 'invalid', message: 'This licence file is not valid.', payload: null, nextMaxSeenMs: null }
  }
  const payload = parsed.data
  const publicHex = input.publicKeys[stored.key_id] || input.publicKeys[payload.key_id]
  if (!publicHex || !signatureOk(payload, stored.signature, publicHex)) {
    return { state: 'invalid', message: 'This licence file is not valid.', payload: null, nextMaxSeenMs: null }
  }
  if (payload.device_id_hash !== input.deviceIdHash) {
    return { state: 'device_mismatch', message: 'This licence belongs to a different computer.', payload: null, nextMaxSeenMs: null }
  }
  if (!input.clockOk || input.maxSeenMs == null || input.nowMs + CLOCK_SKEW_MS < input.maxSeenMs) {
    return {
      state: 'clock_rollback',
      message: 'The clock on this computer moved backwards, or the licence check file was removed. Set the correct date and open Synap.surf again.',
      payload: null,
      nextMaxSeenMs: null,
    }
  }
  const refreshBy = Date.parse(payload.refresh_by)
  const expires = Date.parse(payload.expires_at)
  const subscriptionEnds = Date.parse(payload.subscription_ends_at)
  if (Number.isNaN(refreshBy) || Number.isNaN(expires) || Number.isNaN(subscriptionEnds)) {
    return { state: 'invalid', message: 'This licence file is not valid.', payload: null, nextMaxSeenMs: null }
  }
  const nextMaxSeenMs = Math.max(input.nowMs, input.maxSeenMs)
  if (input.nowMs > subscriptionEnds) {
    return {
      state: 'subscription_ended',
      message: `This subscription ended on ${day(payload.subscription_ends_at)}. Renew to keep using Synap.surf. It stays locked offline, and there is no extra time after this date.`,
      payload,
      nextMaxSeenMs,
    }
  }
  const window = judgeWindow(input.nowMs, refreshBy, expires)
  if (window === 'expired') {
    return {
      state: 'expired',
      message: `This licence passed its grace period on ${day(payload.expires_at)}. Connect to refresh it, or enter a key.`,
      payload: null,
      nextMaxSeenMs: null,
    }
  }
  if (window === 'grace') {
    return {
      state: 'grace',
      message: `This licence needed a refresh on ${day(payload.refresh_by)}. It keeps working until ${day(payload.expires_at)}. Synap.surf will refresh it when you are online.`,
      payload,
      nextMaxSeenMs,
    }
  }
  return { state: 'valid', message: '', payload, nextMaxSeenMs }
}

/**
 * SHA-256 of the licence id and device hash. This unwraps the pack content
 * key the update server seals for this device. It is not the key that
 * encrypts delta.sqlite.enc. Callers must not open pack bytes when the gate
 * says locked.
 */
export function derivePackKey(payload: Pick<LicencePayload, 'licence_id' | 'device_id_hash'>): Buffer {
  return createHash('sha256').update(`synap.pack.v1\n${payload.licence_id}\n${payload.device_id_hash}`).digest()
}

export type PackGate =
  | { status: 'ready'; contentKey: Buffer | null }
  | { status: 'locked'; message: string }
  | { status: 'absent' }

export function gatePackDecrypt(present: boolean, access: { allowed: boolean; contentKey: Buffer | null; encrypted: boolean }): PackGate {
  if (!present) return { status: 'absent' }
  if (!access.allowed) {
    return { status: 'locked', message: 'A valid licence is required before this knowledge pack can be opened.' }
  }
  if (access.encrypted && !access.contentKey) {
    return { status: 'locked', message: 'This knowledge pack is encrypted. A licence is required to derive the pack key.' }
  }
  return { status: 'ready', contentKey: access.contentKey }
}
