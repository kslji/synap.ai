/**
 * Database key storage with Electron safeStorage (main process).
 * macOS: Keychain, Windows: DPAPI, Linux: libsecret/kwallet when available.
 * We use the ASYNC API: the sync encryptString/decryptString is marked "may be deprecated" in the
 * Electron 44 docs and is removed on Electron's main branch [VERIFY when upgrading Electron].
 */
import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const KEY_FILE = () => join(app.getPath('userData'), 'db.key.enc');

export async function getOrCreateDbKey(): Promise<string> {
  const weakLinux = process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text';
  if (weakLinux || !(await safeStorage.isAsyncEncryptionAvailable())) {
    // On Linux without a secret service Electron falls back to a hard-coded password ("basic_text"),
    // which is NOT real protection. Phase 1 targets macOS + Windows only; tell the user on Linux.
    throw new Error('OS secure storage unavailable - cannot protect the database key');
  }
  const file = KEY_FILE();
  if (existsSync(file)) {
    const result = await safeStorage.decryptStringAsync(await readFile(file));
    // shouldReEncrypt: the OS key was rotated or a stronger one is available -> store a fresh ciphertext.
    if (result.shouldReEncrypt) await writeAtomic(file, await safeStorage.encryptStringAsync(result.result));
    return result.result;
  }
  const keyHex = randomBytes(32).toString('hex');
  await writeAtomic(file, await safeStorage.encryptStringAsync(keyHex));
  return keyHex;
}

async function writeAtomic(path: string, data: Buffer): Promise<void> {
  await writeFile(path + '.tmp', data, { mode: 0o600 });
  await rename(path + '.tmp', path);
}
