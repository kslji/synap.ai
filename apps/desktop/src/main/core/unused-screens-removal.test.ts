/**
 * Dead screens stay dead. `IDELayout.tsx` exported a chat layout nothing ever rendered, and
 * `IDECodeEditor.tsx` was a second copy of the code editor that no screen imported while
 * `CodeEditor.tsx` was the one in use.
 *
 * A file nothing points at is a file nothing runs, so it never gets fixed and only gets compiled
 * until someone deletes the wrong thing beside it. Both checks read the tree, so they run anywhere.
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SCREENS = join(DESKTOP, 'src/renderer/src/screens')
const DEAD = ['IDELayout.tsx', 'IDECodeEditor.tsx']

/** Every TypeScript source under `dir`, so a reintroduced import cannot hide in one folder. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      out.push(...sources(path))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(path)
    }
  }
  return out
}

test('the screens nothing rendered are gone from the tree', () => {
  for (const name of DEAD) {
    assert.equal(existsSync(join(SCREENS, name)), false, `src/renderer/src/screens/${name} must stay deleted`)
  }
})

test('no source names the screens that were deleted', () => {
  const pointing: string[] = []
  for (const file of sources(join(DESKTOP, 'src'))) {
    // This file has to name them to check they stay gone.
    if (file.includes('unused-screens-removal')) continue
    const text = readFileSync(file, 'utf8')
    for (const name of DEAD) {
      if (text.includes(name.replace(/\.tsx$/, ''))) pointing.push(`${resolve(DESKTOP, file).split(DESKTOP + '/')[1]} -> ${name}`)
    }
  }
  assert.deepEqual(pointing, [], 'an unused file is only dead while nothing refers to it')
})

/**
 * The other half of the audit: files a name search calls unreferenced but the compiler
 * reads anyway. Ambient `.d.ts` declarations are picked up by a tsconfig `include`, never
 * by an `import`, so deleting one because nothing names it breaks the typecheck silently.
 */
const ROOT = resolve(DESKTOP, '../..')
const AMBIENT: [string, string | null][] = [
  // re-export shim: the package's own index.d.ts is hidden from moduleResolution NodeNext,
  // and several storage modules import the native driver by that name
  ['apps/desktop/src/main/better-sqlite3-multiple-ciphers.d.ts', "from 'better-sqlite3-multiple-ciphers'"],
  // declares import.meta.glob, which the agent catalog uses to read the agents/ tree
  ['packages/shared/src/vite-glob.d.ts', 'import.meta.glob'],
  // declares the asset modules; needed the moment one is imported again
  ['packages/ui/src/assets.d.ts', null],
]

test('the ambient declarations nothing imports are still there', () => {
  for (const [rel] of AMBIENT) {
    assert.equal(existsSync(join(ROOT, rel)), true, `${rel} is read by the compiler, not imported; it must stay`)
  }
})

test('each ambient declaration still answers a real need', () => {
  for (const [rel, need] of AMBIENT) {
    if (!need) continue
    const users: string[] = []
    for (const dir of ['apps/desktop/src', 'apps/web/src', 'packages', 'services']) {
      const base = join(ROOT, dir)
      if (!existsSync(base)) continue
      for (const file of sourcesFlat(base)) {
        if (file === join(ROOT, rel)) continue
        if (readFileSync(file, 'utf8').toLowerCase().includes(need.toLowerCase())) users.push(file)
      }
    }
    assert.ok(users.length > 0, `${rel} guards ${need}, but nothing uses it any more - retire both together`)
  }
})

/** Every .ts/.tsx file under `dir`, recursively; a broken symlink is skipped, not fatal. */
function sourcesFlat(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourcesFlat(path))
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) out.push(path)
  }
  return out
}
