/**
 * Item 8: line endings and packaged artefacts.
 *
 * A checkout must look the same on every OS (LF everywhere, CRLF only for the
 * Windows scripts that cmd.exe refuses to run otherwise, binaries untouched),
 * and neither installer bundle may carry macOS junk: `.DS_Store` and the
 * AppleDouble `._*` files that `cp -a` and Finder leave behind.
 *
 * The zip check is behavioural — it really runs the packer's zip call and reads
 * the archive back. The rest read files, so they run anywhere.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import JSZip from 'jszip'
import { zipStore } from './pack-offline-zip.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const load = createRequire(import.meta.url)

const TEXT_EXTENSIONS = ['ts', 'tsx', 'js', 'mjs', 'cjs', 'json', 'jsonl', 'md', 'py', 'sh', 'sql', 'yml', 'yaml', 'css', 'html', 'txt', 'toml', 'ini', 'plist', 'snap', 'mdc', 'mako']
const BINARY_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'icns', 'wav', 'mp4', 'pdf', 'sqlite', 'sig', 'wasm', 'node', 'dylib', 'so', 'dll', 'exe', 'a', 'gguf', 'zst', 'tar', 'gz', 'zip', 'pack', 'woff', 'woff2', 'ttf', 'otf']

function attributeLines(): string[] {
  return readFileSync(join(ROOT, '.gitattributes'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

test('the repo pins LF, keeps Windows scripts CRLF and marks binaries', () => {
  const lines = attributeLines()
  assert.ok(lines.includes('* text=auto eol=lf'), 'the default rule must be `* text=auto eol=lf`')
  for (const ext of ['ps1', 'cmd', 'bat']) {
    const rule = lines.find((line) => line.startsWith(`*.${ext} `))
    assert.ok(rule, `*.${ext} needs its own rule`)
    assert.ok(rule.includes('eol=crlf'), `*.${ext} must be CRLF: ${rule}`)
    assert.ok(rule.includes('text'), `*.${ext} must stay text: ${rule}`)
  }
  const binary = lines.filter((line) => line.endsWith('binary'))
  const covered = new Set(binary.map((line) => line.split(/\s+/)[0]))
  for (const ext of BINARY_EXTENSIONS) {
    assert.ok(covered.has(`*.${ext}`), `*.${ext} must be marked binary`)
  }
  for (const ext of TEXT_EXTENSIONS) {
    assert.equal(covered.has(`*.${ext}`), false, `*.${ext} is text and must not be marked binary`)
  }
  // Every binary the repository actually tracks is covered by a rule above.
  const junk = ['*.DS_Store', '*._*']
  for (const ext of junk) {
    assert.equal(covered.has(ext), false, `${ext} is not a file type; it is ignored, not attributed`)
  }
})

test('the installer config ships no macOS junk', () => {
  const config = load(join(ROOT, 'apps', 'desktop', 'electron-builder.cjs')) as {
    files: string[]
    extraResources: { from: string; to: string; filter?: string[] }[]
  }
  for (const ghost of ['!**/.DS_Store', '!**/._*']) {
    assert.ok(config.files.includes(ghost), `files must exclude ${ghost}`)
  }
  for (const entry of config.extraResources) {
    // A plain file needs no filter; a copied folder must not drag in Finder litter.
    if (/\.[a-z0-9]+$/i.test(entry.from)) continue
    assert.ok(Array.isArray(entry.filter), `extraResources ${entry.from} must filter its copies`)
    assert.ok(entry.filter.includes('**/*'), `extraResources ${entry.from} must still copy everything else`)
    for (const ghost of ['!**/.DS_Store', '!**/._*']) {
      assert.ok(entry.filter.includes(ghost), `extraResources ${entry.from} must exclude ${ghost}`)
    }
  }
})

test('the offline zip leaves AppleDouble and .DS_Store out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-hygiene-'))
  try {
    const app = join(dir, 'Synap.surf')
    mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist></plist>\n')
    writeFileSync(join(app, 'Contents', 'Resources', 'model.gguf'), 'weights\n')
    writeFileSync(join(app, 'Contents', '.DS_Store'), 'finder\n')
    writeFileSync(join(app, 'Contents', 'Resources', '._model.gguf'), 'appledouble\n')
    writeFileSync(join(dir, '._Synap.surf'), 'appledouble\n')
    const zipPath = join(dir, 'offline.zip')
    zipStore(app, zipPath)
    const zip = await JSZip.loadAsync(readFileSync(zipPath))
    const names = Object.keys(zip.files)
    assert.ok(names.some((name) => name.endsWith('Contents/Info.plist')), names.join(', '))
    assert.ok(names.some((name) => name.endsWith('Resources/model.gguf')), names.join(', '))
    assert.equal(names.filter((name) => name.endsWith('.DS_Store')).length, 0, `the zip carried .DS_Store: ${names.join(', ')}`)
    assert.equal(names.filter((name) => name.split('/').some((part) => part.startsWith('._'))).length, 0, `the zip carried ._* files: ${names.join(', ')}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the offline packer is the only archive this repo builds', () => {
  const creates = /(?:spawn|exec)Sync\(\s*['"](?:zip|tar)['"]\s*,\s*\[[^\]]*['"]-(?:r|c|czf|cf)/s
  const found: string[] = []
  const scan = (folder: string, keep: (name: string) => boolean) => {
    for (const name of readdirSync(folder)) {
      if (!keep(name)) continue
      const path = join(folder, name)
      if (!existsSync(path) || !statSync(path).isFile()) continue
      if (creates.test(readFileSync(path, 'utf8'))) found.push(name)
    }
  }
  scan(HERE, (name) => /\.(ts|mjs|cjs)$/.test(name) && !name.includes('.test.'))
  scan(join(ROOT, 'scripts'), (name) => !name.includes('.') || /\.(sh|mjs|py)$/.test(name))
  scan(join(ROOT, '.github', 'workflows'), (name) => name.endsWith('.yml'))
  assert.deepEqual(found, ['pack-offline-zip.ts'], `only the offline packer may create an archive, found: ${found.join(', ')}`)
})
