/**
 * After the Mac build, write setup-model.json into a copy of each .app,
 * ad-hoc sign it, and wrap a disk image per size.
 * The disk-image name does not survive dragging the app out, so the choice
 * has to live inside the bundle. Unsigned builds can still ad-hoc sign.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const sizes = [
  ['2b', 'qwen3.5-2b-q4_k_m'],
  ['4b', 'qwen3.5-4b-q4_k_m'],
  ['9b', 'qwen3.5-9b-q4_k_m'],
]

function archOf(dir) {
  if (dir.includes('arm64')) return 'arm64'
  if (dir.includes('x64')) return 'x64'
  return process.arch === 'arm64' ? 'arm64' : 'x64'
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const apps = []
for (const dir of readdirSync(dist, { withFileTypes: true })) {
  if (!dir.isDirectory() || !dir.name.startsWith('mac')) continue
  const app = join(dist, dir.name, 'Synap.surf.app')
  if (existsSync(app)) apps.push({ app, arch: archOf(dir.name) })
}
if (!apps.length) {
  console.error('no Mac app under dist')
  process.exit(1)
}

for (const { app, arch } of apps) {
  for (const [token, model] of sizes) {
    const stage = join(tmpdir(), `surf-dmg-${arch}-${token}`)
    rmSync(stage, { recursive: true, force: true })
    mkdirSync(stage, { recursive: true })
    const staged = join(stage, 'Synap.surf.app')
    cpSync(app, staged, { recursive: true })
    writeFileSync(join(staged, 'Contents', 'Resources', 'setup-model.json'), `${JSON.stringify({ model })}\n`)
    try { execFileSync('xattr', ['-cr', staged], { stdio: 'inherit' }) } catch { /* quarantine bits are optional */ }
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', staged], { stdio: 'inherit' })
    symlinkSync('/Applications', join(stage, 'Applications'))
    const out = join(dist, `Synap.surf-${version}-${arch}-${token}.dmg`)
    execFileSync('hdiutil', ['create', '-volname', 'Synap.surf', '-srcfolder', stage, '-ov', '-format', 'UDZO', out], { stdio: 'inherit' })
    rmSync(stage, { recursive: true, force: true })
    console.log('stamped', out)
  }
}
