/**
 * Test-only guard for suites that need the native SQLite addon.
 *
 * `better-sqlite3-multiple-ciphers` is a native module: its prebuilt .node must
 * match the ABI of the Node process that runs the tests. When node_modules was
 * built for Electron (as in a dev workspace) and the tests run under plain Node,
 * constructing a database segfaults and takes the whole test file down with it.
 *
 * Probe the addon in a child process so that crash stays contained, and let the
 * suites skip with a clear reason instead of dying. When the binding does match
 * (e.g. after `npm install` in a clean clone) the probe succeeds and every test
 * runs normally.
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// This file lives at apps/desktop/src/main/core/, so three levels up is the
// desktop package root, which is where node resolves the hoisted addon from.
const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

let cached: string | undefined | null = null

/** Returns a clear skip reason when the SQLite addon cannot be used here, else undefined. */
export function sqliteSkipReason(): string | undefined {
  if (cached !== null) return cached
  const probe = spawnSync(
    process.execPath,
    ['-e', "new (require('better-sqlite3-multiple-ciphers'))(':memory:').close()"],
    { cwd: DESKTOP_ROOT, encoding: 'utf8', timeout: 20_000 }
  )
  if (probe.status === 0) {
    cached = undefined
    return undefined
  }
  const how = probe.signal ? `signal ${probe.signal}` : `exit ${probe.status}`
  const detail = (probe.stderr || '').trim().split('\n').filter(Boolean).pop() || 'no stderr'
  cached = `native SQLite binding (better-sqlite3-multiple-ciphers) does not match Node ${process.versions.node} `
    + `(${how}); rebuild it for Node to run this suite — ${detail}`
  return cached
}
