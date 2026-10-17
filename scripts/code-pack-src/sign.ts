/**
 * Ed25519 signing for the Code pack manifest.
 * The seed comes from CODE_PACK_SIGNING_KEY or a gitignored dev seed.
 * The private seed is never written into the pack or the repository.
 */
import { createPrivateKey, createPublicKey, randomBytes, sign, type KeyObject } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DEV_SEED_PATH = join(here, '.dev-seed')

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

export function seedToPrivateKey(seed: Buffer): KeyObject {
  if (seed.length !== 32) throw new Error('CODE_PACK_SIGNING_KEY must be 32 bytes (64 hex chars)')
  const pkcs8 = Buffer.concat([PKCS8_PREFIX, seed])
  return createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
}

export function publicHex(privateKey: KeyObject): string {
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url').toString('hex')
}

export function signManifest(body: Buffer, privateKey: KeyObject): Buffer {
  return sign(null, body, privateKey)
}

export function loadSigningSeed(generateDev: boolean): { seed: Buffer; source: 'env' | 'dev-file' | 'generated' } {
  const env = process.env.CODE_PACK_SIGNING_KEY?.trim()
  if (env) {
    if (!/^[0-9a-f]{64}$/i.test(env)) throw new Error('CODE_PACK_SIGNING_KEY must be 64 hex characters')
    return { seed: Buffer.from(env, 'hex'), source: 'env' }
  }
  if (existsSync(DEV_SEED_PATH)) {
    const text = readFileSync(DEV_SEED_PATH, 'utf8').trim()
    if (!/^[0-9a-f]{64}$/i.test(text)) throw new Error(`${DEV_SEED_PATH} is not 64 hex characters`)
    return { seed: Buffer.from(text, 'hex'), source: 'dev-file' }
  }
  if (!generateDev) {
    throw new Error('Set CODE_PACK_SIGNING_KEY, or pass --dev-key to create a gitignored dev seed. Refusing to invent a signing key the app does not trust.')
  }
  return { seed: randomBytes(32), source: 'generated' }
}

export function writeDevSeed(seed: Buffer): void {
  writeFileSync(DEV_SEED_PATH, `${seed.toString('hex')}\n`, { mode: 0o600 })
}
