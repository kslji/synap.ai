/**
 * Device id is a SHA-256. Callers pass stable OS or hardware identifiers.
 * The hash is what gets stored and signed. Raw identifiers are not written
 * into the licence file.
 */
import { createHash } from 'node:crypto'

export const DEVICE_ID_SALT = 'synap.surf.device.v1'

export function deviceIdHash(parts: readonly string[], salt = DEVICE_ID_SALT): string {
  const cleaned = parts.map((part) => part.trim()).filter((part) => part.length > 0)
  if (cleaned.length === 0) throw new Error('device id needs a stable identifier')
  return createHash('sha256').update([salt, ...cleaned].join('\n')).digest('hex')
}
