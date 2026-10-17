/**
 * Copy the Windows installer once per size. NSIS reads $EXEFILE at install
 * time and writes resources\setup-model.json. The bytes of the exe do not change.
 */
import { copyFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const tokens = ['2b', '4b', '9b']
const exe = readdirSync(dist).find((name) => name.endsWith('.exe') && !name.includes('uninstall') && !/-(2b|4b|9b|offline-2b)\.exe$/i.test(name))
if (!exe) {
  console.error('no plain Windows installer in dist')
  process.exit(1)
}
for (const token of tokens) {
  const dest = exe.replace(/\.exe$/i, `-${token}.exe`)
  copyFileSync(join(dist, exe), join(dist, dest))
  const size = statSync(join(dist, dest)).size
  console.log('copied', dest, size)
}
