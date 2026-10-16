/**
 * Cache the unwrapped pack content key.
 * Electron safeStorage (Keychain / DPAPI / libsecret) when that store is real.
 * Linux basic_text and a missing OS store keep the key in process memory only.
 * The key is never written as plaintext.
 */
import { safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const FILE = 'pack-content.key.enc'
let memory: Buffer | null = null

function osStoreReady(): boolean {
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false
  return true
}

export async function storePackContentKey(userData: string, key: Buffer): Promise<void> {
  memory = Buffer.from(key)
  if (!osStoreReady() || !(await safeStorage.isAsyncEncryptionAvailable())) return
  const file = join(userData, FILE)
  const cipher = await safeStorage.encryptStringAsync(key.toString('hex'))
  await writeFile(`${file}.tmp`, cipher, { mode: 0o600 })
  await rename(`${file}.tmp`, file)
}

export async function loadPackContentKey(userData: string): Promise<Buffer | null> {
  if (memory?.length === 32) return Buffer.from(memory)
  if (!osStoreReady() || !(await safeStorage.isAsyncEncryptionAvailable())) return null
  const file = join(userData, FILE)
  if (!existsSync(file)) return null
  const result = await safeStorage.decryptStringAsync(await readFile(file))
  if (!/^[0-9a-f]{64}$/i.test(result.result)) return null
  memory = Buffer.from(result.result, 'hex')
  if (result.shouldReEncrypt) {
    const cipher = await safeStorage.encryptStringAsync(memory.toString('hex'))
    await writeFile(`${file}.tmp`, cipher, { mode: 0o600 })
    await rename(`${file}.tmp`, file)
  }
  return Buffer.from(memory)
}
