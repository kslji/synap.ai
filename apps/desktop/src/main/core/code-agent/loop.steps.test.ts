/**
 * What the loop shows the model, and what it refuses to accept.
 *
 * A 2B does not guess file contents well: it rewrites a neighbouring line, edits the first of two
 * literals, or never creates the file the task names. These tests pin the four rules that answer
 * that - the requested files in the first prompt, a MISSING FILE marker, a repeated read turned
 * into an edit, and a check that runs before finish - without a model in the loop.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { runCodeAgent, type CodeAgentHost, type CommandRunner } from './loop.js'
import type { ModelTurn } from './parse-tool.js'
import { heuristicCounter } from '../token-budget.js'

const LIMITS = 'export function fits(size: number): boolean {\n  return size <= 1024\n}\n\nexport function chunk(size: number): number {\n  return size / 1024\n}\n'

const edit = (path: string, old: string, next: string): ModelTurn => ({ content: JSON.stringify({ tool: 'propose_edit', arguments: { path, old, new: next } }) })
const read = (path: string): ModelTurn => ({ content: JSON.stringify({ tool: 'read_file', arguments: { path } }) })
const finish: ModelTurn = { content: '{"tool":"finish","arguments":{"summary":"Done."}}' }

function project(files: Record<string, string>): string {
  // realpath: on macOS tmpdir() is a symlink into /private, and the sandbox compares real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'surf-loop-steps-')))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

/** A model that answers with these turns in order, and the requests it was asked. */
function scripted(turns: ModelTurn[]): { complete: CodeAgentHost['complete']; requests: Parameters<CodeAgentHost['complete']>[0][] } {
  const requests: Parameters<CodeAgentHost['complete']>[0][] = []
  let turn = 0
  return {
    requests,
    async complete(req) {
      requests.push(req)
      const answer = turns[turn] ?? finish
      turn += 1
      return answer
    },
  }
}

function makeHost(root: string, complete: CodeAgentHost['complete'], verify?: string[], runCommand?: CommandRunner): CodeAgentHost {
  return {
    root,
    rules: 'TypeScript with no semicolons.',
    counter: heuristicCounter,
    promptBudget: 2600,
    searchBudget: 200,
    answerTokens: 200,
    mode: 'auto',
    verify,
    search: { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } },
    complete,
    async ask() { return { allow: true } },
    runCommand,
  }
}

function promptOf(req: Parameters<CodeAgentHost['complete']>[0] | undefined, at = -1): string {
  const message = req?.messages.at(at)
  return typeof message?.content === 'string' ? message.content : ''
}

test('the first prompt already holds the file the request names', async () => {
  const root = project({ 'src/math.ts': 'export function add(a: number, b: number): number {\n  return a + b\n}\n' })
  const { complete, requests } = scripted([edit('src/math.ts', 'function add(', 'function sum('), finish])
  try {
    const result = await runCodeAgent('Rename the function add to sum in src/math.ts.', makeHost(root, complete))
    assert.equal(result.stopped, 'finish')
    const first = promptOf(requests[0])
    assert.match(first, /1\|export function add\(a: number, b: number\): number \{/, 'the numbered contents are not in the first prompt')
    assert.match(first, /2\| {2}return a \+ b/)
    assert.equal(readFileSync(join(root, 'src/math.ts'), 'utf8'), 'export function sum(a: number, b: number): number {\n  return a + b\n}\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a file the request names but nothing has written is marked, and finish is refused until it exists', async () => {
  const root = project({ 'src/x.ts': 'export const LIMIT = 10\nexport const x = LIMIT + 1\n' })
  const { complete, requests } = scripted([
    finish,
    edit('src/limits.ts', '', 'export const LIMIT = 10\n'),
    finish,
    edit('src/x.ts', "export const LIMIT = 10\nexport const x = LIMIT + 1\n", "import { LIMIT } from './limits'\n\nexport const x = LIMIT + 1\n"),
    finish,
  ])
  try {
    const result = await runCodeAgent('Define LIMIT once in a new file src/limits.ts and import it in src/x.ts.', makeHost(root, complete))
    assert.match(promptOf(requests[0]), /MISSING FILE/, 'the prompt does not say which file has to be created')
    assert.match(promptOf(requests[1]), /src\/limits\.ts/, 'the refused finish does not name the missing file')
    assert.equal(existsSync(join(root, 'src/limits.ts')), true)
    assert.match(promptOf(requests[3]), /src\/x\.ts/)
    assert.equal(result.stopped, 'finish')
    assert.equal(readFileSync(join(root, 'src/x.ts'), 'utf8'), "import { LIMIT } from './limits'\n\nexport const x = LIMIT + 1\n")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reading the same file twice is answered instead of stopping, and the next turn is forced to the edit tool', async () => {
  const root = project({ 'src/load.ts': 'export function load(path: string): string {\n  return path.toUpperCase()\n}\n' })
  const { complete, requests } = scripted([
    read('src/load.ts'),
    read('src/load.ts'),
    edit('src/load.ts', 'export function load(path: string): string {', 'export function load(path: string): Promise<string> {'),
    finish,
  ])
  try {
    const result = await runCodeAgent('Make load in src/load.ts return a Promise.', makeHost(root, complete))
    assert.equal(result.stopped, 'finish')
    assert.match(promptOf(requests[2]), /already read/i, 'the repeated read was not turned into an edit')
    const format = requests[2]?.responseFormat as { json_schema: { schema: { properties: { tool: { enum: string[] } } } } } | undefined
    assert.deepEqual(format?.json_schema.schema.properties.tool.enum, ['propose_edit'], 'the next turn was not forced to propose_edit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an edit that leaves the old text further down the file says where it is', async () => {
  const root = project({ 'src/limits.ts': LIMITS })
  const { complete, requests } = scripted([
    edit('src/limits.ts', '  return size <= 1024', '  return size <= MAX_BYTES'),
    finish,
  ])
  try {
    const result = await runCodeAgent('In src/limits.ts, replace both 1024s with a constant named MAX_BYTES.', makeHost(root, complete))
    assert.equal(result.stopped, 'finish')
    const observed = promptOf(requests[1])
    assert.match(observed, /Still in src\/limits\.ts/, 'the tool result does not point at the 1024 left in chunk')
    assert.match(observed, /line 6/, 'the tool result does not say which line still has it')
    assert.match(observed, /export function chunk/, 'the tool result does not show the rest of the file')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed check is fed back with the file contents before a finish is accepted', async () => {
  const root = project({ 'src/limits.ts': LIMITS, 'package.json': '{"private":true}\n' })
  const { complete, requests } = scripted([
    edit('src/limits.ts', '  return size <= 1024', '  return size <= MAX_BYTES'),
    finish,
    edit('src/limits.ts', 'export function fits(', 'const MAX_BYTES = 1024\n\nexport function fits('),
    finish,
  ])
  let checks = 0
  const commands: string[] = []
  try {
    const result = await runCodeAgent('In src/limits.ts, replace both 1024s with a constant named MAX_BYTES.', makeHost(root, complete, ['npm test'], async (command) => {
      commands.push(command)
      checks += 1
      return checks === 1
        ? { ok: false, output: 'not ok 1 - both functions use MAX_BYTES\n  AssertionError: 1024 !== undefined\n  at check.test.ts:4:3' }
        : { ok: true, output: 'ok 1 - both functions use MAX_BYTES' }
    }))
    assert.equal(result.stopped, 'finish')
    assert.deepEqual(commands, ['npm test', 'npm test'], 'the check did not run before the finish and again after the fix')
    const fix = promptOf(requests[2])
    assert.match(fix, /AssertionError: 1024 !== undefined/, 'the failure text did not reach the model')
    assert.match(fix, /1\|export function fits/, 'the current file contents did not reach the model')
    assert.equal(requests[2]?.thinking, true, 'the first fix turn did not think')
    assert.equal(readFileSync(join(root, 'src/limits.ts'), 'utf8').includes('const MAX_BYTES = 1024'), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a fix turn sees every check that failed, the lines the compiler named, and no stack frames', async () => {
  const root = project({ 'src/a.ts': "export const a: 1 = 1\nexport const b = a\n" })
  const { complete, requests } = scripted([
    edit('src/a.ts', 'export const b = a', 'export const b = 2'),
    finish,
    edit('src/a.ts', 'export const b = 2', 'export const b = a'),
    finish,
  ])
  const commands: string[] = []
  let round = 0
  try {
    const result = await runCodeAgent('Point b at 2 in src/a.ts.', makeHost(root, complete, ['npm run typecheck', 'npm test'], async (command) => {
      commands.push(command)
      round += 1
      if (round > 2) return { ok: true, output: 'ok' }
      return command === 'npm test'
        ? { ok: false, output: 'TAP version 13\nnot ok 1 - b is two\n  AssertionError: 1 !== 2\n  stack: |-\n    at check.test.ts:9:3\n' }
        : { ok: false, output: "src/a.ts(2,14): error TS2322: Type '1' is not assignable to type '2'.\n" }
    }))
    assert.equal(result.stopped, 'finish')
    assert.deepEqual(commands, ['npm run typecheck', 'npm test', 'npm run typecheck', 'npm test'], 'a failing first check skipped the second')
    const fix = promptOf(requests[2])
    assert.match(fix, /error TS2322/, 'the type error did not reach the model')
    assert.match(fix, /AssertionError: 1 !== 2/, 'the failing assertion did not reach the model')
    assert.match(fix, /src\/a\.ts line 2: "export const b = 2"/, 'the line the compiler named was not quoted')
    assert.doesNotMatch(fix, /at check\.test\.ts/, 'stack frames took the room the failure needed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a fix turn cannot edit a file the request did not name', async () => {
  const check = "import { a } from './src/a'\nexport const expected = 2\n"
  const root = project({ 'src/a.ts': 'export const a = 1\n', 'check.test.ts': check })
  const { complete, requests } = scripted([
    edit('src/a.ts', 'export const a = 1', 'export const a = 2'),
    finish,
    edit('check.test.ts', 'export const expected = 2', 'export const expected = 1'),
    edit('src/a.ts', 'export const a = 2', 'export const a = 1'),
    finish,
  ])
  try {
    const result = await runCodeAgent('Set a to 2 in src/a.ts.', makeHost(root, complete, ['npm test'], async () => ({ ok: false, output: 'AssertionError: 1 !== 2' })))
    assert.equal(readFileSync(join(root, 'check.test.ts'), 'utf8'), check, 'the check itself was edited to make it pass')
    assert.match(promptOf(requests[3]), /not what the request asked to change/i, 'the refusal does not say why the edit was refused')
    assert.match(promptOf(requests[3]), /src\/a\.ts/, 'the refusal does not name the file to change')
    assert.equal(result.diffs.some((diff) => diff.path === 'check.test.ts' && diff.status === 'applied'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a run that never touches the file it was asked for still stops instead of looping forever', async () => {
  const root = project({ 'src/a.ts': 'export const a = 1\n' })
  const { complete } = scripted([finish, finish, finish, finish, finish, finish])
  try {
    const result = await runCodeAgent('Bump the constant in src/a.ts.', makeHost(root, complete), undefined)
    assert.equal(result.stopped, 'finish')
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const a = 1\n', 'nothing was written and nothing claimed it was')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
