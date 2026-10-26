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
