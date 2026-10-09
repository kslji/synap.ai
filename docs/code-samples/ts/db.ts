/**
 * Local databases (Electron main process only - never the renderer).
 *   user.db  : private, read-write, encrypted (SQLCipher v4 format via better-sqlite3-multiple-ciphers)
 *   packs    : public knowledge packs, plaintext, opened READ-ONLY
 * Both load sqlite-vec (vector search) and use the FTS5 module compiled into SQLite.
 *
 * Tested 2026-10-09: a user.db written this way opens in the sqlcipher 4.6.1 CLI with the same key.
 */
import Database from 'better-sqlite3-multiple-ciphers';
import * as sqliteVec from 'sqlite-vec';

export type DB = Database.Database;

/**
 * sqlite-vec ships vec0.{dylib,so,dll} in a per-platform npm package (sqlite-vec-darwin-arm64, ...).
 * In a packaged app node_modules lives inside app.asar, which SQLite cannot dlopen, so electron-builder
 * must `asarUnpack` it and we rewrite the path to app.asar.unpacked.
 */
export function vecExtensionPath(): string {
  return sqliteVec.getLoadablePath().replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

function loadVec(db: DB): void {
  db.loadExtension(vecExtensionPath());
  const { v } = db.prepare('SELECT vec_version() AS v').get() as { v: string };
  if (!v.startsWith('v0.')) throw new Error(`unexpected sqlite-vec version ${v}`);
}

/**
 * Open (or create) the encrypted user DB.
 * @param keyHex 64 hex chars = random 32-byte raw key (from key-store.ts). A raw key skips the
 *               PBKDF2 step, which is fine because the key is random, not a human password.
 */
export function openUserDb(path: string, keyHex: string, migrations: string[] = []): DB {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('key must be 32 bytes hex');
  const db = new Database(path);
  db.pragma(`cipher='sqlcipher'`); // SQLCipher-compatible format instead of the library default (sqleet)
  db.pragma('legacy=4'); //           SQLCipher v4 parameters
  db.pragma(`key="x'${keyHex}'"`);
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get(); // fails fast on a wrong key
  } catch (e) {
    db.close();
    throw new Error(`cannot open user.db (wrong key or corrupt file): ${(e as Error).message}`);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  loadVec(db);
  migrate(db, migrations);
  return db;
}

/** Minimal forward-only migrations using PRAGMA user_version. migrations[0] = version 1, ... */
export function migrate(db: DB, migrations: string[]): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

/** Open a downloaded, signature-verified pack. Read-only + query_only: the app can never modify it. */
export function openPackDb(path: string): DB {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  loadVec(db);
  return db;
}

/** Re-key, e.g. when the safeStorage key is rotated. */
export function rekeyUserDb(db: DB, newKeyHex: string): void {
  if (!/^[0-9a-f]{64}$/i.test(newKeyHex)) throw new Error('key must be 32 bytes hex');
  db.pragma(`rekey="x'${newKeyHex}'"`);
}
