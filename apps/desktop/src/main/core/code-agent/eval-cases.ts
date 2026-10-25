/**
 * The 20 tasks of the agent eval, and the rule that scores them.
 *
 * Kept out of the runner so the tasks can be checked without a model: every fixture, every
 * expectation, and the scoring itself are pure data plus one function. `code-agent-eval.ts`
 * starts llama-server and runs each task twice - once through `runCodeAgent` (no decomposition)
 * and once through `runSplitTask` (triage, plan, checks, failure ladder).
 *
 * Each case also carries `tests`, a behavioural check the fixture can actually run, and
 * `solution`, the files a correct answer ends with. `eval-cases.test.ts` proves both directions
 * without a model: the untouched fixture fails its own test, and the solution passes it.
 */

export interface Check {
  path: string
  /** Text the finished file must contain. */
  has?: string[]
  /** Text the finished file must no longer contain. */
  missing?: string[]
}

export interface EvalCase {
  id: string
  task: string
  files: Record<string, string>
  /** Files written beside the fixture that make `npm test` a real check of the behaviour. */
  tests: Record<string, string>
  /** What the files look like when the task is done properly; the fixture test must pass on these. */
  solution: Record<string, string>
  check: Check[]
}

const RULES = 'TypeScript with no semicolons, two-space indents, single quotes.'

/** The house style the eval tells the model about; exported so the runner and the tests agree. */
export const EVAL_RULES = RULES

const NODE = `import assert from 'node:assert/strict'
import { test } from 'node:test'
`

/** Ten tasks in one file, ten that need two or more files touched together. */
export const AGENT_EVAL_CASES: EvalCase[] = [
  {
    id: 'rename-add',
    task: 'Rename the function add to sum in src/math.ts.',
    files: { 'src/math.ts': 'export function add(a: number, b: number): number {\n  return a + b\n}\n' },
    tests: {
      'check.test.ts': `${NODE}import { sum } from './src/math'

test('sum is exported and adds two numbers', () => {
  assert.equal(typeof sum, 'function')
  assert.equal(sum(2, 3), 5)
})
`,
    },
    solution: { 'src/math.ts': 'export function sum(a: number, b: number): number {\n  return a + b\n}\n' },
    check: [{ path: 'src/math.ts', has: ['function sum('], missing: ['function add('] }],
  },
  {
    id: 'retries-five',
    task: 'In src/config.ts, change retries from 3 to 5.',
    files: { 'src/config.ts': 'export const retries = 3\nexport const timeout = 1000\n' },
    tests: {
      'check.test.ts': `${NODE}import { retries, timeout } from './src/config'

test('retries is five and the timeout is untouched', () => {
  assert.equal(retries, 5)
  assert.equal(timeout, 1000)
})
`,
    },
    solution: { 'src/config.ts': 'export const retries = 5\nexport const timeout = 1000\n' },
    check: [{ path: 'src/config.ts', has: ['retries = 5'], missing: ['retries = 3'] }],
  },
  {
    id: 'divide-guard',
    task: 'In src/divide.ts, make divide return 0 when b is 0.',
    files: { 'src/divide.ts': 'export function divide(a: number, b: number): number {\n  return a / b\n}\n' },
    tests: {
      'check.test.ts': `${NODE}import { divide } from './src/divide'

test('a zero divisor returns 0 instead of Infinity', () => {
  assert.equal(divide(4, 2), 2)
  assert.equal(divide(1, 0), 0)
})
`,
    },
    solution: {
      'src/divide.ts': 'export function divide(a: number, b: number): number {\n  if (b === 0) return 0\n  return a / b\n}\n',
    },
    check: [{ path: 'src/divide.ts', has: ['b === 0', 'return 0'] }],
  },
  {
    id: 'greet-template',
    task: 'In src/greet.ts, use a template literal instead of concatenating strings.',
    files: { 'src/greet.ts': "export function greet(name: string): string {\n  return 'Hello, ' + name\n}\n" },
    tests: {
      'check.test.ts': `${NODE}import { readFileSync } from 'node:fs'
import { greet } from './src/greet'

test('greet interpolates the name with a template literal', () => {
  assert.equal(greet('Sam'), 'Hello, Sam')
  const text = readFileSync('src/greet.ts', 'utf8')
  assert.match(text, /\\\$\\{name\\}/, 'greet still concatenates instead of interpolating')
  assert.doesNotMatch(text, /' \\+ name/)
})
`,
    },
    solution: { 'src/greet.ts': 'export function greet(name: string): string {\n  return `Hello, ${name}`\n}\n' },
    check: [{ path: 'src/greet.ts', has: ['${name}'], missing: ["' + name"] }],
  },
  {
    id: 'log-prefix',
    task: 'In src/log.ts, give log an optional prefix parameter, printed before the message.',
    files: { 'src/log.ts': 'export function log(message: string): void {\n  console.log(message)\n}\n' },
    tests: {
      'check.test.ts': `${NODE}import { log } from './src/log'

test('log takes an optional prefix and still prints a bare message', () => {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  try {
    log('ready', 'boot')
    log('ready')
  } finally {
    console.log = original
  }
  assert.equal(lines.length, 2, 'both calls must print one line each')
  assert.ok((lines[0] ?? '').includes('ready'), 'the message is missing from the prefixed line')
  assert.ok((lines[0] ?? '').includes('boot'), 'the prefix is missing from the prefixed line')
  assert.ok((lines[1] ?? '').includes('ready'), 'the message is missing when no prefix is passed')
})
`,
    },
    solution: {
      'src/log.ts': 'export function log(message: string, prefix?: string): void {\n  console.log(prefix ? `${prefix} ${message}` : message)\n}\n',
    },
    check: [{ path: 'src/log.ts', has: ['prefix'] }],
  },
  {
    id: 'max-bytes',
    task: 'In src/limits.ts, replace both 1024s with a constant named MAX_BYTES.',
    files: {
      'src/limits.ts': 'export function fits(size: number): boolean {\n  return size <= 1024\n}\n\nexport function chunk(size: number): number {\n  return size / 1024\n}\n',
    },
    tests: {
      'check.test.ts': `${NODE}import { MAX_BYTES, chunk, fits } from './src/limits'

test('both functions use the MAX_BYTES constant', () => {
  assert.equal(MAX_BYTES, 1024)
  assert.equal(fits(1024), true)
  assert.equal(fits(1025), false)
  assert.equal(chunk(2048), 2)
})
`,
    },
    solution: {
      'src/limits.ts': 'export const MAX_BYTES = 1024\n\nexport function fits(size: number): boolean {\n  return size <= MAX_BYTES\n}\n\nexport function chunk(size: number): number {\n  return size / MAX_BYTES\n}\n',
    },
    check: [{ path: 'src/limits.ts', has: ['MAX_BYTES'], missing: ['<= 1024', '/ 1024'] }],
  },
  {
    id: 'strict-eq',
    task: 'In src/eq.ts, use strict equality.',
    files: { 'src/eq.ts': 'export function same(a: number, b: number): boolean {\n  return a == b\n}\n' },
    tests: {
      'check.test.ts': `${NODE}import { readFileSync } from 'node:fs'
import { same } from './src/eq'

test('same uses strict equality', () => {
  assert.equal(same(1, 1), true)
  assert.equal(same(1, 2), false)
  const text = readFileSync('src/eq.ts', 'utf8')
  assert.doesNotMatch(text, /[^=!<>]==[^=]/, 'same still uses a loose equality')
})
`,
    },
    solution: { 'src/eq.ts': 'export function same(a: number, b: number): boolean {\n  return a === b\n}\n' },
    check: [{ path: 'src/eq.ts', has: ['a === b'], missing: ['a == b'] }],
  },
  {
    id: 'first-item',
    task: 'In src/first.ts, first should return the first item, not the last.',
    files: { 'src/first.ts': 'export function first(items: string[]): string | undefined {\n  return items[items.length - 1]\n}\n' },
    tests: {
      'check.test.ts': `${NODE}import { first } from './src/first'

test('first returns the first item', () => {
  assert.equal(first(['a', 'b']), 'a')
  assert.equal(first([]), undefined)
})
`,
    },
    solution: { 'src/first.ts': 'export function first(items: string[]): string | undefined {\n  return items[0]\n}\n' },
    check: [{ path: 'src/first.ts', has: ['items[0]'], missing: ['length - 1'] }],
  },
  {
    id: 'export-version',
    task: 'In src/version.ts, also export VERSION as a named export.',
    files: { 'src/version.ts': "const VERSION = '1.0.0'\nexport default VERSION\n" },
    tests: {
      'check.test.ts': `${NODE}import fallback, { VERSION } from './src/version'

test('VERSION is a named export and the default still works', () => {
  assert.equal(VERSION, '1.0.0')
  assert.equal(fallback, '1.0.0')
})
`,
    },
    solution: { 'src/version.ts': "export const VERSION = '1.0.0'\nexport default VERSION\n" },
    check: [{ path: 'src/version.ts', has: ['export const VERSION'] }],
  },
  {
    id: 'todo-comment',
    task: 'In src/todo.ts, replace the TODO comment with a sentence saying the loop is capped at three.',
    files: { 'src/todo.ts': '// TODO: fix later\nexport const limit = 3\n' },
    tests: {
      'check.test.ts': `${NODE}import { readFileSync } from 'node:fs'
import { limit } from './src/todo'

test('the TODO is replaced by a sentence about the cap', () => {
  assert.equal(limit, 3)
  const text = readFileSync('src/todo.ts', 'utf8')
  assert.doesNotMatch(text, /TODO/, 'the TODO is still in the file')
  assert.match(text, /three/i, 'the comment does not say the loop is capped at three')
})
`,
    },
    solution: { 'src/todo.ts': '// The loop is capped at three.\nexport const limit = 3\n' },
    check: [{ path: 'src/todo.ts', has: ['three'], missing: ['TODO'] }],
  },
  {
    id: 'rename-fmt',
    task: 'Rename fmt to formatTitle in src/fmt.ts and src/app.ts.',
    files: {
      'src/fmt.ts': 'export function fmt(value: string): string {\n  return value.trim()\n}\n',
      'src/app.ts': "import { fmt } from './fmt'\n\nexport const title = fmt('  hi  ')\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { formatTitle } from './src/fmt'
import { title } from './src/app'

test('the renamed function is exported and its caller uses it', () => {
  assert.equal(formatTitle('  hi  '), 'hi')
  assert.equal(title, 'hi')
})
`,
    },
    solution: {
      'src/fmt.ts': 'export function formatTitle(value: string): string {\n  return value.trim()\n}\n',
      'src/app.ts': "import { formatTitle } from './fmt'\n\nexport const title = formatTitle('  hi  ')\n",
    },
    check: [
      { path: 'src/fmt.ts', has: ['function formatTitle('], missing: ['function fmt('] },
      { path: 'src/app.ts', has: ['formatTitle'], missing: [' fmt('] },
    ],
  },
  {
    id: 'add-timeout',
    task: 'Add a timeout parameter to fetchUser in src/api.ts and pass 1000 at the call site in src/caller.ts.',
    files: {
      'src/api.ts': 'export function fetchUser(id: number): string {\n  return `user-${id}`\n}\n',
      'src/caller.ts': "import { fetchUser } from './api'\n\nexport const name = fetchUser(1)\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { readFileSync } from 'node:fs'
import { fetchUser } from './src/api'
import { name } from './src/caller'

test('fetchUser takes a timeout and the caller passes 1000', () => {
  assert.match(readFileSync('src/api.ts', 'utf8'), /timeout/, 'fetchUser has no timeout parameter')
  assert.match(readFileSync('src/caller.ts', 'utf8'), /1000/, 'the call site does not pass 1000')
  assert.equal(fetchUser(1), 'user-1')
  assert.equal(name, 'user-1')
})
`,
    },
    solution: {
      'src/api.ts': 'export function fetchUser(id: number, timeout = 0): string {\n  void timeout\n  return `user-${id}`\n}\n',
      'src/caller.ts': "import { fetchUser } from './api'\n\nexport const name = fetchUser(1, 1000)\n",
    },
    check: [
      { path: 'src/api.ts', has: ['timeout'] },
      { path: 'src/caller.ts', has: ['1000'] },
    ],
  },
  {
    id: 'move-base-url',
    task: 'Move BASE_URL out of src/a.ts into src/b.ts and import it back in src/a.ts.',
    files: {
      'src/a.ts': "export const BASE_URL = 'https://example.test'\n\nexport function url(path: string): string {\n  return BASE_URL + path\n}\n",
      'src/b.ts': "export const name = 'b'\n",
    },
    tests: {
      'check.test.ts': `${NODE}import * as a from './src/a'
import * as b from './src/b'

test('BASE_URL is defined in b and imported by a', () => {
  assert.equal(b.BASE_URL, 'https://example.test')
  assert.equal((a as Record<string, unknown>).BASE_URL, undefined, 'a still defines BASE_URL')
  assert.equal(a.url('/x'), 'https://example.test/x')
})
`,
    },
    solution: {
      'src/a.ts': "import { BASE_URL } from './b'\n\nexport function url(path: string): string {\n  return BASE_URL + path\n}\n",
      'src/b.ts': "export const BASE_URL = 'https://example.test'\n\nexport const name = 'b'\n",
    },
    check: [
      { path: 'src/b.ts', has: ['BASE_URL'] },
      { path: 'src/a.ts', has: ['BASE_URL'], missing: ['export const BASE_URL'] },
    ],
  },
  {
    id: 'parse-null',
    task: 'In src/parse.ts return null for an empty string, and make src/run.ts handle that null.',
    files: {
      'src/parse.ts': 'export function parse(text: string): number {\n  return Number(text)\n}\n',
      'src/run.ts': "import { parse } from './parse'\n\nexport function run(text: string): number {\n  return parse(text)\n}\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { parse } from './src/parse'
import { run } from './src/run'

test('parse returns null for an empty string', () => {
  assert.equal(parse(''), null)
  assert.equal(parse('2'), 2)
})

test('run handles the null instead of passing it on', () => {
  assert.equal(run(''), 0)
  assert.equal(run('2'), 2)
})
`,
    },
    solution: {
      'src/parse.ts': "export function parse(text: string): number | null {\n  if (text.trim() === '') return null\n  return Number(text)\n}\n",
      'src/run.ts': "import { parse } from './parse'\n\nexport function run(text: string): number {\n  return parse(text) ?? 0\n}\n",
    },
    check: [
      { path: 'src/parse.ts', has: ['null'] },
      { path: 'src/run.ts', has: ['null'] },
    ],
  },
  {
    id: 'shared-limit',
    task: 'Define LIMIT once in a new file src/limits.ts and import it in src/x.ts and src/y.ts.',
    files: {
      'src/x.ts': 'export const LIMIT = 10\nexport const x = LIMIT + 1\n',
      'src/y.ts': 'export const LIMIT = 10\nexport const y = LIMIT + 2\n',
    },
    tests: {
      'check.test.ts': `${NODE}
import { LIMIT } from './src/limits'
import { x } from './src/x'
import { y } from './src/y'

test('LIMIT is defined once and imported twice', () => {
  assert.equal(LIMIT, 10)
  assert.equal(x, 11)
  assert.equal(y, 12)
})
`,
    },
    solution: {
      'src/limits.ts': 'export const LIMIT = 10\n',
      'src/x.ts': "import { LIMIT } from './limits'\n\nexport const x = LIMIT + 1\n",
      'src/y.ts': "import { LIMIT } from './limits'\n\nexport const y = LIMIT + 2\n",
    },
    check: [
      { path: 'src/limits.ts', has: ['LIMIT'] },
      { path: 'src/x.ts', has: ['LIMIT'], missing: ['export const LIMIT'] },
      { path: 'src/y.ts', has: ['LIMIT'], missing: ['export const LIMIT'] },
    ],
  },
  {
    id: 'row-note',
    task: 'Add an optional note field to Row in src/types.ts and include it in the label built in src/table.ts.',
    files: {
      'src/types.ts': 'export interface Row {\n  id: string\n  count: number\n}\n',
      'src/table.ts': "import type { Row } from './types'\n\nexport function label(row: Row): string {\n  return `${row.id}: ${row.count}`\n}\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { label } from './src/table'

test('the label includes the optional note', () => {
  assert.ok(label({ id: 'a', count: 2, note: 'fresh' }).includes('fresh'), 'the note is not in the label')
  assert.ok(label({ id: 'a', count: 2 }).includes('a'), 'a row without a note must still label')
})
`,
    },
    solution: {
      'src/types.ts': 'export interface Row {\n  id: string\n  count: number\n  note?: string\n}\n',
      'src/table.ts': "import type { Row } from './types'\n\nexport function label(row: Row): string {\n  return row.note ? `${row.id}: ${row.count} ${row.note}` : `${row.id}: ${row.count}`\n}\n",
    },
    check: [
      { path: 'src/types.ts', has: ['note'] },
      { path: 'src/table.ts', has: ['note'] },
    ],
  },
  {
    id: 'async-load',
    task: 'Make load in src/load.ts async and await it in src/main.ts.',
    files: {
      'src/load.ts': 'export function load(path: string): string {\n  return path.toUpperCase()\n}\n',
      'src/main.ts': "import { load } from './load'\n\nexport async function main(): Promise<string> {\n  return load('a')\n}\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { load } from './src/load'
import { main } from './src/main'

test('load is async and main awaits it', async () => {
  const pending = load('a') as Promise<string>
  assert.equal(typeof pending?.then, 'function', 'load still returns a plain string')
  assert.equal(await pending, 'A')
  assert.equal(await main(), 'A')
})
`,
    },
    solution: {
      'src/load.ts': 'export async function load(path: string): Promise<string> {\n  return path.toUpperCase()\n}\n',
      'src/main.ts': "import { load } from './load'\n\nexport async function main(): Promise<string> {\n  return await load('a')\n}\n",
    },
    check: [
      { path: 'src/load.ts', has: ['async'] },
      { path: 'src/main.ts', has: ['await'] },
    ],
  },
  {
    id: 'nan-check',
    task: "Make check in src/check.ts reject NaN as well, and change the 'bad' message in src/form.ts to 'invalid'.",
    files: {
      'src/check.ts': 'export function check(value: number): boolean {\n  return value > 0\n}\n',
      'src/form.ts': "import { check } from './check'\n\nexport function form(value: number): string {\n  return check(value) ? 'ok' : 'bad'\n}\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { check } from './src/check'
import { form } from './src/form'

test('NaN is rejected and the message reads invalid', () => {
  assert.equal(check(NaN), false)
  assert.equal(check(1), true)
  assert.equal(form(0), 'invalid')
  assert.equal(form(1), 'ok')
})
`,
    },
    solution: {
      'src/check.ts': 'export function check(value: number): boolean {\n  return !Number.isNaN(value) && value > 0\n}\n',
      'src/form.ts': "import { check } from './check'\n\nexport function form(value: number): string {\n  return check(value) ? 'ok' : 'invalid'\n}\n",
    },
    check: [
      { path: 'src/check.ts', has: ['NaN'] },
      { path: 'src/form.ts', has: ['invalid'], missing: ["'bad'"] },
    ],
  },
  {
    id: 'missing-file',
    task: "Change the message in src/err.ts to 'Missing file' and use that message in src/handle.ts.",
    files: {
      'src/err.ts': "export const MESSAGE = 'Not found'\nexport function fail(): string {\n  return MESSAGE\n}\n",
      'src/handle.ts': "export const fallback = 'Something went wrong'\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { readFileSync } from 'node:fs'
import { fail, MESSAGE } from './src/err'
import { fallback } from './src/handle'

test('the message changed and handle reuses it instead of its own copy', () => {
  assert.equal(MESSAGE, 'Missing file')
  assert.equal(fail(), 'Missing file')
  assert.equal(fallback, 'Missing file')
  assert.match(readFileSync('src/handle.ts', 'utf8'), /from ['"]\\.\\/err['"]/, 'handle hardcodes the message instead of importing it')
})
`,
    },
    solution: {
      'src/err.ts': "export const MESSAGE = 'Missing file'\nexport function fail(): string {\n  return MESSAGE\n}\n",
      'src/handle.ts': "import { MESSAGE } from './err'\n\nexport const fallback = MESSAGE\n",
    },
    check: [
      { path: 'src/err.ts', has: ['Missing file'] },
      { path: 'src/handle.ts', has: ['MESSAGE'], missing: ["'Something went wrong'"] },
    ],
  },
  {
    id: 'counter-reset',
    task: 'In src/counter.ts add a reset function that sets count back to 0, and call it in src/ui.ts before building the label.',
    files: {
      'src/counter.ts': 'export let count = 0\nexport function bump(): void {\n  count += 1\n}\n',
      'src/ui.ts': "import { count } from './counter'\n\nexport function label(): string {\n  return `count: ${count}`\n}\n",
    },
    tests: {
      'check.test.ts': `${NODE}import { bump, count, reset } from './src/counter'
import { label } from './src/ui'

test('reset sets count back to zero', () => {
  bump()
  bump()
  reset()
  assert.equal(count, 0)
})

test('the label resets the counter before building it', () => {
  bump()
  assert.equal(label(), 'count: 0')
})
`,
    },
    solution: {
      'src/counter.ts': 'export let count = 0\nexport function bump(): void {\n  count += 1\n}\n\nexport function reset(): void {\n  count = 0\n}\n',
      'src/ui.ts': "import { count, reset } from './counter'\n\nexport function label(): string {\n  reset()\n  return `count: ${count}`\n}\n",
    },
    check: [
      { path: 'src/counter.ts', has: ['reset'] },
      { path: 'src/ui.ts', has: ['reset'] },
    ],
  },
]

/**
 * Score a finished run. `texts` maps each checked path to its content after the agent stopped,
 * or null when the file is not there. Every rule must hold; the reason names the first miss.
 */
export function scoreFiles(texts: Record<string, string | null>, c: EvalCase): { pass: boolean; why: string } {
  for (const rule of c.check) {
    const text = texts[rule.path]
    if (text == null) return { pass: false, why: `${rule.path} missing` }
    for (const needle of rule.has ?? []) {
      if (!text.includes(needle)) return { pass: false, why: `${rule.path} lacks "${needle}"` }
    }
    for (const needle of rule.missing ?? []) {
      if (text.includes(needle)) return { pass: false, why: `${rule.path} still has "${needle}"` }
    }
  }
  return { pass: true, why: '' }
}
