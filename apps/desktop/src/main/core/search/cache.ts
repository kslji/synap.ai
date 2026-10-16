/**
 * Search rows expire after 24 hours. Page text expires after 7 days.
 * The table lives in the encrypted user database. Cleanup is counted on the Storage page.
 */
import { createHash } from 'node:crypto'
import type { DB } from '../db.js'

export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000
export const PAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SEARCH_CACHE_CAP_BYTES = 32 * 1024 * 1024

export const SEARCH_CACHE_MIGRATION = `
CREATE TABLE search_disk_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('search', 'page')),
  payload TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`

export type CacheKind = 'search' | 'page'

export function cacheKey(kind: CacheKind, region: string, value: string): string {
  return createHash('sha256').update(kind).update('\n').update(region).update('\n').update(value).digest('hex')
}

function ready(db: DB | null): db is DB {
  if (!db) return false
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'search_disk_cache'").get() as { ok?: number } | undefined
  return Boolean(row?.ok)
}

export function purgeSearchCache(db: DB | null, now = Date.now()): void {
  if (!ready(db)) return
  db.prepare('DELETE FROM search_disk_cache WHERE expires_at <= ?').run(now)
}

export function searchCacheStats(db: DB | null): { bytes: number; count: number; capBytes: number } {
  if (!ready(db)) return { bytes: 0, count: 0, capBytes: SEARCH_CACHE_CAP_BYTES }
  purgeSearchCache(db)
  const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM search_disk_cache').get() as { count: number; bytes: number }
  return { bytes: row.bytes, count: row.count, capBytes: SEARCH_CACHE_CAP_BYTES }
}

export function clearSearchCache(db: DB | null): void {
  if (!ready(db)) return
  db.prepare('DELETE FROM search_disk_cache').run()
}

export function readCache(db: DB | null, kind: CacheKind, region: string, value: string, now = Date.now()): string | null {
  return readCacheMeta(db, kind, region, value, now)?.payload ?? null
}

export function readCacheMeta(db: DB | null, kind: CacheKind, region: string, value: string, now = Date.now()): { payload: string; fetchedAt: number } | null {
  if (!ready(db)) return null
  const key = cacheKey(kind, region, value)
  const row = db.prepare('SELECT payload, fetched_at AS fetchedAt, expires_at AS expiresAt FROM search_disk_cache WHERE cache_key = ?').get(key) as { payload: string; fetchedAt: number; expiresAt: number } | undefined
  if (!row) return null
  if (row.expiresAt <= now) {
    db.prepare('DELETE FROM search_disk_cache WHERE cache_key = ?').run(key)
    return null
  }
  return { payload: row.payload, fetchedAt: row.fetchedAt }
}

export function writeCache(db: DB | null, kind: CacheKind, region: string, value: string, payload: string, now = Date.now()): void {
  if (!ready(db) || !payload) return
  const size = Buffer.byteLength(payload, 'utf8')
  if (size > SEARCH_CACHE_CAP_BYTES) return
  const ttl = kind === 'search' ? SEARCH_TTL_MS : PAGE_TTL_MS
  const key = cacheKey(kind, region, value)
  db.prepare(
    `INSERT INTO search_disk_cache (cache_key, kind, payload, byte_size, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (cache_key) DO UPDATE SET payload = excluded.payload, byte_size = excluded.byte_size, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
  ).run(key, kind, payload, size, now, now + ttl)
  evict(db, now)
}

function evict(db: DB, now: number): void {
  purgeSearchCache(db, now)
  const sum = () => (db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM search_disk_cache').get() as { bytes: number }).bytes
  while (sum() > SEARCH_CACHE_CAP_BYTES) {
    const oldest = db.prepare('SELECT cache_key AS key FROM search_disk_cache ORDER BY fetched_at ASC LIMIT 1').get() as { key: string } | undefined
    if (!oldest) return
    db.prepare('DELETE FROM search_disk_cache WHERE cache_key = ?').run(oldest.key)
  }
}
