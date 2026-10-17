/**
 * After the Mac build, write setup-model.json into a copy of each .app,
 * ad-hoc sign it, and wrap a disk image per size.
 * The disk-image name does not survive dragging the app out, so the choice
 * has to live inside the bundle. Unsigned builds can still ad-hoc sign.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const sizes = [
  ['2b', 'qwen3.5-2b-q4_k_m'],
  ['4b', 'qwen3.5-4b-q4_k_m'],
  ['9b', 'qwen3.5-9b-q4_k_m'],
]

function bundleArch(app) {
  const macOs = join(app, 'Contents', 'MacOS')
  const binName = readdirSync(macOs).find((name) => !name.startsWith('.'))
  if (!binName) return null
  const archs = execFileSync('lipo', ['-archs', join(macOs, binName)], { encoding: 'utf8' })
  if (archs.includes('arm64')) return 'arm64'
  if (/x86_64|x64/.test(archs)) return 'x64'
  return null
}

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const apps = []
if (existsSync(dist)) {
  for (const dir of readdirSync(dist, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('mac')) continue
    const folder = join(dist, dir.name)
    const name = readdirSync(folder).find((entry) => entry.endsWith('.app'))
    if (!name) continue
    const app = join(folder, name)
    const arch = bundleArch(app)
    if (arch) apps.push({ app, arch })
  }
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
    const staged = join(stage, basename(app))
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
