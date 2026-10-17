/**
 * Dependency and asset licence check.
 * Allows common permissive licences. Everything else must be named in scripts/licence-allow.json.
 * Audio files and reference clips must not be part of the desktop package list.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const allow = JSON.parse(readFileSync(join(root, 'scripts/licence-allow.json'), 'utf8'))
const npmAllow = new Set(allow.npm ?? [])
const OK = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0',
  'Python-2.0', 'BlueOak-1.0.0', 'MPL-2.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'LGPL-2.1-only',
  'Artistic-2.0', 'Zlib', 'WTFPL',   'CC-BY-4.0', 'CC-BY-3.0', 'UNLICENSED', 'BSD',
])

const ALIASES = {
  Apache: 'Apache-2.0',
  'Apache Software License': 'Apache-2.0',
  BSD: 'BSD-3-Clause',
}

function licenceOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return String(pkg.licenses[0].type)
  return ''
}

function walkPackages(dir, out) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name === '.bin' || name === '.cache') continue
    const path = join(dir, name)
    if (name.startsWith('@')) {
      walkPackages(path, out)
      continue
    }
    const meta = join(path, 'package.json')
    if (!existsSync(meta)) continue
    out.push(meta)
  }
}

const metas = []
walkPackages(join(root, 'node_modules'), metas)
const bad = []
for (const meta of metas) {
  const pkg = JSON.parse(readFileSync(meta, 'utf8'))
  const name = String(pkg.name || meta)
  if (name.startsWith('@surf/') || pkg.private === true) continue
  const licence = licenceOf(pkg).replace(/\*$/, '')
  const cleaned = licence.replace(/[()]/g, '').trim()
  const mode = /\sOR\s/.test(cleaned) ? 'or' : 'and'
  const parts = cleaned.split(mode === 'or' ? /\s+OR\s+/ : /\s+AND\s+/).map((part) => part.trim()).filter(Boolean)
  const known = (part) => OK.has(part) || OK.has(ALIASES[part] || '') || npmAllow.has(`${name}@${part}`) || npmAllow.has(name)
  const ok = parts.length > 0 && (mode === 'or' ? parts.some(known) : parts.every(known))
  if (!ok) bad.push(`${name}: ${licence || 'missing'}`)
}

function walkFiles(dir, out) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'out') continue
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) walkFiles(path, out)
    else out.push(path)
  }
}

const assets = []
for (const dir of ['animation', 'apps', 'packages', 'resources']) walkFiles(join(root, dir), assets)
// Test fixtures are not shipped, so a wav used only by a unit test is not a package asset.
const audio = assets.filter((path) => /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(path) && !/[\\/]fixtures[\\/]/.test(path))
const packagedClips = assets.filter((path) => /animation\/mp4\/.+\.mp4$/i.test(path) && path.includes(`${join('apps', 'desktop', 'out')}`))
const builder = readFileSync(join(root, 'apps/desktop/electron-builder.cjs'), 'utf8')
if (!builder.includes('!**/*.mp4') || /from:\s*'animation\/mp4'/.test(builder)) bad.push('electron-builder packages a reference clip')

if (bad.length || audio.length || packagedClips.length) {
  console.error(JSON.stringify({ bad: bad.slice(0, 40), audio, packagedClips }, null, 2))
  process.exit(1)
}
console.log(`licences ok packages=${metas.length}`)
