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
    const format = requests[2]?.responseFormat as { json_schema: { schema: { properties: { tool: { enum: string[] } } } } } | undefined
    assert.deepEqual(format?.json_schema.schema.properties.tool.enum, ['propose_edit'], 'the turn after a failed check was not forced to an edit')
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
  const times = new Map<string, number>()
  try {
    const result = await runCodeAgent('Point b at 2 in src/a.ts.', makeHost(root, complete, ['npm run typecheck', 'npm test'], async (command) => {
      commands.push(command)
      // Each command answers for the file as it stands, not for the number of times it has run: a
      // compile is now reported while the edit is fresh, so the check order is part of the behaviour.
      if (command === 'npm run typecheck') {
        return readFileSync(join(root, 'src/a.ts'), 'utf8').includes('export const b = 2')
          ? { ok: false, output: "src/a.ts(2,14): error TS2322: Type '1' is not assignable to type '2'.\n" }
          : { ok: true, output: 'ok' }
      }
      const seen = (times.get(command) ?? 0) + 1
      times.set(command, seen)
      return seen === 1
        ? { ok: false, output: 'TAP version 13\nnot ok 1 - b is two\n  AssertionError: 1 !== 2\n  stack: |-\n    at check.test.ts:9:3\n' }
        : { ok: true, output: 'ok' }
    }))
    assert.equal(result.stopped, 'finish')
    assert.deepEqual(commands, ['npm run typecheck', 'npm run typecheck', 'npm test', 'npm run typecheck', 'npm run typecheck', 'npm test'], 'a failing first check skipped the second')
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


test('a missing name and a default import are repaired with the import the project needs', async () => {
  const q = String.fromCharCode(34)
  const root = project({
    'src/counter.ts': 'export let count = 0\n\nexport function reset(): void {\n  count = 0\n}\n',
    'src/ui.ts': 'import count from ' + q + './counter' + q + '\n\nexport function label(): string {\n  reset()\n  return `count: ${count}`\n}\n',
  })
  const { complete, requests } = scripted([
    edit('src/counter.ts', 'export let count = 0', 'export let count = 0\n'),
    edit('src/ui.ts', '  reset()', '  reset()\n  reset()'),
    finish,
    finish,
  ])
  const where = join(root, 'src/counter')
  const failure = [
    `src/ui.ts(1,8): error TS2613: Module '${q}${where}${q}' has no default export. Did you mean to use 'import { count } from ${q}${where}${q}' instead?`,
    `src/ui.ts(4,3): error TS2552: Cannot find name 'reset'. Did you mean 'onreset'?`,
  ].join('\n')
  try {
    await runCodeAgent('Make label reset the counter in src/ui.ts using src/counter.ts.', makeHost(root, complete, ['npm test'], async () => ({ ok: false, output: failure })))
    const fix = promptOf(requests[3])
    assert.match(fix, /import [{] count [}] from '.*counter'/, 'the default import was not repaired with the named one')
    assert.match(fix, /reset is exported by src.counter[.]ts/, 'the missing name was not traced to the file that exports it')
    assert.match(fix, /import [{] reset [}] from '.*counter'/, 'the missing import was not spelled out')
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

/** A `node:test` failure as the runner prints it, with the frames a 2B cannot use. */
function tapFailure(file: string, row: number): string {
  return [
    'TAP version 13',
    '# Subtest: the constant is exported',
    'not ok 1 - the constant is exported',
    '  ---',
    '  duration_ms: 1.20875',
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    '    Expected values to be strictly equal:',
    '    + undefined',
    '    - 1024',
    "  code: 'ERR_ASSERTION'",
    '  stack: |-',
    `    TestContext.<anonymous> (${file}:${row}:10)`,
    '    Test.runInAsyncScope (node:async_hooks:214:14)',
    '    Test.run (node:internal/test_runner/test:1047:25)',
    '  ...',
    '1..1',
    '# tests 1',
    '# pass 0',
    '# fail 1',
    '# duration_ms 263.943875',
  ].join('\n')
}

test('the fix prompt quotes the line of the check that failed and drops the runner noise', async () => {
  // A failing assertion says what is wrong in the test's own words. The file it names is the one
  // requirement the model missed, and it is the only line of the failure worth its tokens.
  const root = project({
    'src/limits.ts': LIMITS,
    'check.test.ts': "import assert from 'node:assert/strict'\nimport { test } from 'node:test'\nimport { MAX_BYTES } from './src/limits'\n\ntest('the constant is exported', () => {\n  assert.equal(MAX_BYTES, 1024)\n})\n",
  })
  const { complete, requests } = scripted([
    edit('src/limits.ts', '  return size <= 1024', '  return size <= MAX_BYTES'),
    finish,
    edit('src/limits.ts', 'export function fits(', 'export const MAX_BYTES = 1024\n\nexport function fits('),
    finish,
  ])
  try {
    await runCodeAgent('In src/limits.ts, replace both 1024s with a constant named MAX_BYTES.', makeHost(root, complete, ['npm test'], async () => {
      const round = requests.length
      if (round > 2) return { ok: true, output: 'ok 1 - the constant is exported' }
      return { ok: false, output: tapFailure(join(root, 'check.test.ts'), 6) }
    }))
    const fix = promptOf(requests[2])
    assert.match(fix, /check\.test\.ts line 6: " {2}assert\.equal\(MAX_BYTES, 1024\)"/, 'the failing line of the check was not quoted')
    assert.match(fix, /assert\.equal\(MAX_BYTES, 1024\)/, 'the assertion the run failed was not shown')
    assert.doesNotMatch(fix, /TestContext|runInAsyncScope|duration_ms|node:internal/, 'the runner noise took the room the failure needed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a fix turn that puts a file back where the check already failed is refused', async () => {
  // Two states that fail two different checks are how a small model oscillates: it answers the
  // compiler by undoing the test failure, and the test by undoing the compiler error, forever.
  const root = project({ 'src/a.ts': 'export const a = 1\n' })
  const { complete, requests } = scripted([
    edit('src/a.ts', 'export const a = 1', 'export const a = 2'),
    finish,
    edit('src/a.ts', 'export const a = 2', 'export const a = 3'),
    finish,
    edit('src/a.ts', 'export const a = 3', 'export const a = 2'),
    finish,
  ])
  const seen: string[] = []
  try {
    const result = await runCodeAgent('Set a to 4 in src/a.ts.', makeHost(root, complete, ['npm test'], async () => {
      seen.push(readFileSync(join(root, 'src/a.ts'), 'utf8'))
      return { ok: false, output: `AssertionError: a is wrong while ${seen.at(-1)!.trim()}` }
    }))
    assert.equal(seen.length > 2, true, 'the check did not run again after each fix')
    const refused = result.steps.find((step) => step.status === 'error' && /already failed|checked before/.test(step.detail ?? ''))
    assert.ok(refused, 'the run went back to a state the check had already rejected')
    assert.match(promptOf(requests[5]), /already failed|checked before/, 'the refusal never reached the model')
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const a = 3\n', 'the refused edit was written anyway')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a name nothing in the project defines is declared, not imported from nowhere', async () => {
  const root = project({ 'src/limits.ts': 'export function fits(size: number): boolean {\n  return size <= 1024\n}\n' })
  const { complete, requests } = scripted([
    edit('src/limits.ts', '  return size <= 1024', '  return size <= MAX_BYTES'),
    finish,
    finish,
  ])
  try {
    await runCodeAgent('In src/limits.ts, replace the 1024 with a constant named MAX_BYTES.', makeHost(root, complete, ['npm test'], async () => ({
      ok: false,
      output: "src/limits.ts(2,17): error TS2304: Cannot find name 'MAX_BYTES'.\n",
    })))
    const fix = promptOf(requests[2])
    assert.match(fix, /MAX_BYTES is not defined anywhere here/, 'the missing name was not said plainly')
    assert.match(fix, /export const MAX_BYTES = /, 'the fix was not written out as the line to add')
    assert.doesNotMatch(fix, /import \{ MAX_BYTES \}/, 'the model was sent to import a name nobody exports')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an edit that already failed with these arguments is answered, not run again', async () => {
  // A small model that is told "not found" tends to read the file and send the same text again from
  // memory. Running it twice costs a step for the same words; the answer has to say it is a repeat.
  const root = project({ 'src/load.ts': 'export function load(path: string): string {\n  return path.toUpperCase()\n}\n' })
  const stale = edit('src/load.ts', 'return path.toLowerCase()', 'return path.toUpperCase()')
  const { complete, requests } = scripted([
    stale,
    read('src/load.ts'),
    stale,
    edit('src/load.ts', 'export function load(path: string): string {\n  return path.toUpperCase()', 'export async function load(path: string): Promise<string> {\n  return path.toUpperCase()'),
    finish,
  ])
  try {
    const result = await runCodeAgent('Make load in src/load.ts async and give it a Promise return type.', makeHost(root, complete))
    assert.match(promptOf(requests[3]), /already (tried|sent).*same|the same .*already failed/i, 'the repeat was answered with the plain error again')
    assert.equal(readFileSync(join(root, 'src/load.ts'), 'utf8'), 'export async function load(path: string): Promise<string> {\n  return path.toUpperCase()\n}\n')
    assert.equal(result.stopped, 'finish')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a line that was removed is not nagged about the text the rest of the file keeps', async () => {
  // The "still in the file" nudge exists for a change only half made. A deletion has no other half:
  // the words the removed line shared with the rest of the file are the file's own business.
  const root = project({ 'src/a.ts': 'export const a = 1\nexport const b = 1\n' })
  const { complete, requests } = scripted([edit('src/a.ts', 'export const a = 1\n', ''), finish])
  try {
    const result = await runCodeAgent('Delete the export of a from src/a.ts.', makeHost(root, complete))
    assert.doesNotMatch(promptOf(requests[1]), /Still in src\/a\.ts/, 'a deletion was nagged about a number the other line still has')
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const b = 1\n')
    assert.equal(result.stopped, 'finish')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a name declared twice is pointed at the one line that can do both jobs', async () => {
  // The model answered "export VERSION as a named export" by adding a second declaration. The
  // compiler says "redeclare"; the fix it needs is the one line that declares and exports.
  const root = project({ 'src/version.ts': "const VERSION = '1.0.0'\nexport default VERSION\n" })
  const { complete, requests } = scripted([
    edit('src/version.ts', "const VERSION = '1.0.0'\nexport default VERSION", "const VERSION = '1.0.0'\nexport const VERSION = '1.0.0'\nexport default VERSION"),
    finish,
    finish,
  ])
  try {
    await runCodeAgent('In src/version.ts, also export VERSION as a named export.', makeHost(root, complete, ['npm test'], async () => ({
      ok: false,
      output: "src/version.ts(1,7): error TS2451: Cannot redeclare block-scoped variable 'VERSION'.\nsrc/version.ts(2,14): error TS2451: Cannot redeclare block-scoped variable 'VERSION'.\n",
    })))
    const fix = promptOf(requests[2])
    assert.match(fix, /VERSION is declared twice in src\/version\.ts/, 'the duplicate declaration was not said plainly')
    assert.match(fix, /export const VERSION = /, 'the one line that fixes it was not written out')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the nudge about text left behind reads the file, not the numbers beside its lines', async () => {
  // The edit was finished. The "still in the file" check read the numbered listing, took the digit
  // in "2|" for text the task left behind, and sent a done model back to change a line number.
  const root = project({ 'src/first.ts': 'export function first(items: string[]): string | undefined {\n  return items[items.length - 1]\n}\n' })
  const { complete, requests } = scripted([
    edit('src/first.ts', '  return items[items.length - 1]', '  return items[0]'),
    finish,
  ])
  try {
    const result = await runCodeAgent('In src/first.ts, first should return the first item, not the last.', makeHost(root, complete))
    assert.doesNotMatch(promptOf(requests[1]), /Still in src\/first\.ts/, 'the line number was read as text the file still had')
    assert.equal(result.stopped, 'finish')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a fix that does not do what the failed check asked for is refused', async () => {
  // The check said the name is not defined. The model answered by taking the name away, which is a
  // way out of the error that leaves the task undone - and a fix turn is too short to spend on it.
  const source = 'export function fits(size: number): boolean {\n  return size <= 1024\n}\n'
  const root = project({ 'src/limits.ts': source })
  const { complete, requests } = scripted([
    edit('src/limits.ts', '  return size <= 1024', '  return size <= MAX_BYTES'),
    finish,
    edit('src/limits.ts', '  return size <= MAX_BYTES', '  return size <= 1024'),
    edit('src/limits.ts', 'export function fits', 'export const MAX_BYTES = 1024\n\nexport function fits'),
    finish,
  ])
  try {
    const result = await runCodeAgent('In src/limits.ts, replace the 1024 with a constant named MAX_BYTES.', makeHost(root, complete, ['npm test'], async () => {
      const text = readFileSync(join(root, 'src/limits.ts'), 'utf8')
      return text.includes('export const MAX_BYTES')
        ? { ok: true, output: 'ok 1 - the constant is exported' }
        : { ok: false, output: "src/limits.ts(2,18): error TS2304: Cannot find name 'MAX_BYTES'.\n" }
    }))
    const refused = result.steps.find((step) => step.status === 'error' && /the failed check asked/.test(step.detail ?? ''))
    assert.ok(refused, 'the fix that undid the change was applied')
    assert.match(promptOf(requests[3]), /the failed check asked/, 'the refusal never reached the model')
    assert.equal(readFileSync(join(root, 'src/limits.ts'), 'utf8'), 'export const MAX_BYTES = 1024\n\nexport function fits(size: number): boolean {\n  return size <= MAX_BYTES\n}\n')
    assert.equal(result.stopped, 'finish')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a broken compile is reported when the edit is made, not when the run finishes', async () => {
  // The edit was accepted and the model finished on top of it. The typecheck only spoke at the
  // finish, a turn too late for a 2B to connect the error to the line it had just typed, so the
  // same broken hunk came back. The compile has to answer while the edit is the freshest thing.
  const root = project({ 'src/load.ts': 'export function load(path: string): string {\n  return path.toUpperCase()\n}\n' })
  const commands: string[] = []
  const broken = edit('src/load.ts', 'export function load(path: string): string {', 'export async function load(path: string): string {')
  const { complete, requests } = scripted([broken, broken, finish])
  try {
    const result = await runCodeAgent('Make load async in src/load.ts.', makeHost(root, complete, ['npm run typecheck'], async (command) => {
      commands.push(command)
      return { ok: false, output: "src/load.ts(1,8): error TS1005: '}' expected.\n" }
    }))
    assert.match(promptOf(requests[1]), /does not compile|error TS1005/, 'the edit that broke the compile was accepted in silence')
    assert.equal(commands[0], 'npm run typecheck')
    // The same call twice is not the same edit twice, and the compile is not paid for twice.
    assert.equal(result.steps.filter((step) => step.tool === 'propose_edit' && step.status === 'applied').length, 1, 'the repeated edit was applied again')
    assert.match(promptOf(requests[2]), /already sent|not finished/i, 'the repeated edit was answered with nothing to act on')
    assert.equal(commands.filter((command) => command === 'npm test').length, 0, 'the full suite ran on the back of an edit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a compile that fails in the file beside the one just edited says so', async () => {
  // The edit was right and the sibling was still broken. A model told "does not compile after this
  // edit" - with a line number from the other file - answered by taking the correct edit back.
  const root = project({
    'src/load.ts': 'export function load(path: string): string {\n  return await path.toUpperCase()\n}\n',
    'src/main.ts': "import { load } from './load'\n\nexport async function main(): Promise<string> {\n  return load('a')\n}\n",
    'src/notes.ts': 'export const note = 1\n',
  })
  const loadFault = "src/load.ts(2,10): error TS1308: 'await' expressions are only allowed within async functions.\n"
  const { complete, requests } = scripted([
    edit('src/main.ts', "  return load('a')", "  return await load('a')"),
    edit('src/notes.ts', 'export const note = 1', 'export const note = 2'),
  ])
  try {
    const result = await runCodeAgent('Await load in src/main.ts and take the note up in src/notes.ts.', makeHost(root, complete, ['npm run typecheck'], async () => {
      // A compiler reads the project: load.ts is broken while its body awaits under a sync header.
      const load = readFileSync(join(root, 'src/load.ts'), 'utf8')
      const broken = load.includes('  return await ') && !load.includes('export async function load')
      return broken ? { ok: false, output: loadFault } : { ok: true, output: 'ok\n' }
    }))
    assert.match(promptOf(requests[1]), /The failure is in another file/, 'a fault in the file beside the edit was blamed on the edit')
    assert.match(promptOf(requests[1]), /src\/load\.ts\(2,10\)/, 'the compile line from the other file was not quoted')
    assert.match(promptOf(requests[2]), /The failure is in another file/, 'the fault moved on without being named')
    assert.notEqual(result.stopped, 'repeat', 'the run was thrown away for editing a second file')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a propose_edit sent twice is answered with the file and the failure, not stopped', async () => {
  // The compile named the import the file does not have. The model sent the same stale hunk again,
  // and a run that stops at the first repeat throws away every step it had left.
  const q = String.fromCharCode(39)
  const root = project({
    'src/counter.ts': 'export let count = 0\nexport function bump(): void {\n  count += 1\n}\n\nexport function reset(): void {\n  count = 0\n}\n',
    'src/ui.ts': `import { count } from ${q}./counter${q}\n\nexport function label(): string {\n  return count\n}\n`,
  })
  const stale = edit('src/ui.ts', '  return count', "  reset()\n  return String(count)")
  const { complete, requests } = scripted([stale, stale, finish])
  try {
    const result = await runCodeAgent('In src/ui.ts, reset the counter in src/counter.ts before building the label.', makeHost(root, complete, ['npm run typecheck'], async () => ({
      ok: false,
      output: `src/ui.ts(3,3): error TS2304: Cannot find name ${q}reset${q}.${q}\n`,
    })))
    assert.match(promptOf(requests[2]), /Cannot find name/, 'the repeat did not come back with the failure it has to answer')
    assert.match(promptOf(requests[2]), /1\|import/, 'the repeat did not come back with the file as it is now')
    assert.match(promptOf(requests[2]), /reset is exported by src\/counter/, 'the repeat did not say where the missing name comes from')
    assert.notEqual(result.stopped, 'repeat', 'the run was thrown away at the first repeat')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a compile that says await is in a sync function points at the line to fix', async () => {
  // The model put await in the body without making the function async. The compileNote shows the
  // TS1308 error, but a 2B needs the line to change spelled out: the header above the await.
  const root = project({
    'src/load.ts': 'export function load(path: string): string {\n  return path.toUpperCase()\n}\n',
    'src/main.ts': "import { load } from './load'\n\nexport async function main(): Promise<string> {\n  return load('a')\n}\n",
  })
  const { complete, requests } = scripted([
    edit('src/load.ts', '  return path.toUpperCase()', '  return await path.toUpperCase()'),
    finish,
  ])
  const error = "src/load.ts(2,10): error TS1308: 'await' expressions are only allowed within async functions.\n"
  try {
    const result = await runCodeAgent('Make load async in src/load.ts.', makeHost(root, complete, ['npm run typecheck'], async () => ({ ok: false, output: error })))
    assert.match(promptOf(requests[1]), /async.*line 1|line 1.*async|add async.*function load|function load.*async/, 'the fix hint did not name the line and keyword to add')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
