/**
 * Renderer bundle size and time until the first window finishes loading.
 * External APIs are not called. The licence dev flag is the unpackaged test bypass.
 */
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const desktop = new URL('..', import.meta.url).pathname
const limitBytes = Number(process.env.SURF_BUNDLE_LIMIT || 80_000_000)
const limitMs = Number(process.env.SURF_STARTUP_LIMIT_MS || 25_000)

function bytes(dir) {
  let total = 0
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name)
    if (name.isDirectory()) total += bytes(path)
    else total += statSync(path).size
  }
  return total
}

const size = bytes(join(desktop, 'out'))
if (size > limitBytes) {
  console.error(`bundle ${size} bytes is over ${limitBytes}`)
  process.exit(1)
}

const user = mkdtempSync(join(tmpdir(), 'surf-budget-'))
const run = spawnSync('npx', ['electron', '.', '--no-sandbox'], {
  cwd: desktop,
  encoding: 'utf8',
  timeout: 60_000,
  env: {
    ...process.env,
    SURF_E2E_QUIT: '1',
    SURF_E2E_DIR: user,
    SYNAP_LICENCE_DEV: '1',
  },
})
rmSync(user, { recursive: true, force: true })
const text = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
const match = text.match(/\[surf\] startup-ms (\d+)/)
if (!match) {
  console.error(text.slice(-2000))
  process.exit(run.status || 1)
}
const startup = Number(match[1])
console.log(`bundle-bytes ${size}`)
console.log(`startup-ms ${startup}`)
if (startup > limitMs) {
  console.error(`startup ${startup} ms is over ${limitMs}`)
  process.exit(1)
}
