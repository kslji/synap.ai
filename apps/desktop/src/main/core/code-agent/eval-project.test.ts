import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveCheck } from './checks.js'
import { AGENT_EVAL_CASES } from './eval-cases.js'
import { evalProjectFiles } from './eval-project.js'
import { runProjectCommand } from './workspace.js'

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')

/** A throwaway project, the way the eval builds one. */
function project(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'surf-eval-project-')))
}

test('an eval fixture has a real typecheck, so a half-done edit fails the step', async () => {
  const root = project()
  mkdirSync(join(root, 'src'), { recursive: true })
  for (const [path, text] of Object.entries(evalProjectFiles(tsc))) writeFileSync(join(root, path), text)
  writeFileSync(join(root, 'src/parse.ts'), 'export function parse(text: string): number {\n  return Number(text)\n}\n')
  writeFileSync(join(root, 'src/run.ts'), "import { parse } from './parse'\n\nexport function run(text: string): number {\n  return parse(text)\n}\n")
  try {
    assert.equal(resolveCheck(root, { kind: 'typecheck', command: '' }).command, 'npm run typecheck')
    const before = await runProjectCommand(root, 'npm run typecheck')
    assert.equal(before.ok, true)

    // Only parse.ts changed. run.ts still promises a number, so the step is not finished.
    writeFileSync(join(root, 'src/parse.ts'), 'export function parse(text: string): number | null {\n  return text ? Number(text) : null\n}\n')
    const half = await runProjectCommand(root, 'npm run typecheck')
    assert.equal(half.ok, false)
    assert.match(half.output, /src\/run\.ts/)

    writeFileSync(join(root, 'src/run.ts'), "import { parse } from './parse'\n\nexport function run(text: string): number {\n  return parse(text) ?? 0\n}\n")
    const after = await runProjectCommand(root, 'npm run typecheck')
    assert.equal(after.ok, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('every eval fixture starts with a clean typecheck', async () => {
  const root = project()
  for (const [path, text] of Object.entries(evalProjectFiles(tsc, { include: ['*/src'] }))) writeFileSync(join(root, path), text)
  for (const c of AGENT_EVAL_CASES) {
    mkdirSync(join(root, c.id), { recursive: true })
    for (const [path, text] of Object.entries(c.files)) {
      mkdirSync(join(root, c.id, path, '..'), { recursive: true })
      writeFileSync(join(root, c.id, path), text)
    }
  }
  try {
    const run = await runProjectCommand(root, 'npm run typecheck')
    assert.equal(run.ok, true, run.output)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
