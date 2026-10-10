/**
 * Connector tokens and the offline cache are one encrypted blob.
 * Tests pass an AES cipher. The app uses Electron safeStorage when the OS keychain is available.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface Cipher {
  encrypt(plain: string): Promise<Buffer>
  decrypt(blob: Buffer): Promise<string>
}

export function aesCipher(key: Buffer): Cipher {
  if (key.length !== 32) throw new Error('connector cipher key must be 32 bytes')
  return {
    async encrypt(plain: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), enc])
    },
    async decrypt(blob: Buffer) {
      const iv = blob.subarray(0, 12)
      const tag = blob.subarray(12, 28)
      const enc = blob.subarray(28)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
    },
  }
}

export function randomCipher(): Cipher {
  return aesCipher(randomBytes(32))
}
