/**
 * The 20 tasks of the agent eval, and the rule that scores them.
 *
 * Kept out of the runner so the tasks can be checked without a model: every fixture, every
 * expectation, and the scoring itself are pure data plus one function. `code-agent-eval.ts`
 * starts llama-server and runs each task twice - once through `runCodeAgent` (no decomposition)
 * and once through `runSplitTask` (triage, plan, checks, failure ladder).
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
  check: Check[]
}

const RULES = 'TypeScript with no semicolons, two-space indents, single quotes.'

/** The house style the eval tells the model about; exported so the runner and the tests agree. */
export const EVAL_RULES = RULES

/** Ten tasks in one file, ten that need two or more files touched together. */
export const AGENT_EVAL_CASES: EvalCase[] = [
  {
    id: 'rename-add',
    task: 'Rename the function add to sum in src/math.ts.',
    files: { 'src/math.ts': 'export function add(a: number, b: number): number {\n  return a + b\n}\n' },
    check: [{ path: 'src/math.ts', has: ['function sum('], missing: ['function add('] }],
  },
  {
    id: 'retries-five',
    task: 'In src/config.ts, change retries from 3 to 5.',
    files: { 'src/config.ts': 'export const retries = 3\nexport const timeout = 1000\n' },
    check: [{ path: 'src/config.ts', has: ['retries = 5'], missing: ['retries = 3'] }],
  },
  {
    id: 'divide-guard',
    task: 'In src/divide.ts, make divide return 0 when b is 0.',
    files: { 'src/divide.ts': 'export function divide(a: number, b: number): number {\n  return a / b\n}\n' },
    check: [{ path: 'src/divide.ts', has: ['b === 0', 'return 0'] }],
  },
  {
    id: 'greet-template',
    task: 'In src/greet.ts, use a template literal instead of concatenating strings.',
    files: { 'src/greet.ts': 'export function greet(name: string): string {\n  return \'Hello, \' + name\n}\n' },
    check: [{ path: 'src/greet.ts', has: ['${name}'], missing: ["' + name"] }],
  },
  {
    id: 'log-prefix',
    task: 'In src/log.ts, give log an optional prefix parameter, printed before the message.',
    files: { 'src/log.ts': 'export function log(message: string): void {\n  console.log(message)\n}\n' },
    check: [{ path: 'src/log.ts', has: ['prefix'] }],
  },
  {
    id: 'max-bytes',
    task: 'In src/limits.ts, replace both 1024s with a constant named MAX_BYTES.',
    files: {
      'src/limits.ts': 'export function fits(size: number): boolean {\n  return size <= 1024\n}\n\nexport function chunk(size: number): number {\n  return size / 1024\n}\n',
    },
    check: [{ path: 'src/limits.ts', has: ['MAX_BYTES'], missing: ['<= 1024', '/ 1024'] }],
  },
  {
    id: 'strict-eq',
    task: 'In src/eq.ts, use strict equality.',
    files: { 'src/eq.ts': 'export function same(a: number, b: number): boolean {\n  return a == b\n}\n' },
    check: [{ path: 'src/eq.ts', has: ['a === b'], missing: ['a == b'] }],
  },
  {
    id: 'first-item',
    task: 'In src/first.ts, first should return the first item, not the last.',
    files: { 'src/first.ts': 'export function first(items: string[]): string | undefined {\n  return items[items.length - 1]\n}\n' },
    check: [{ path: 'src/first.ts', has: ['items[0]'], missing: ['length - 1'] }],
  },
  {
    id: 'export-version',
    task: 'In src/version.ts, also export VERSION as a named export.',
    files: { 'src/version.ts': "const VERSION = '1.0.0'\nexport default VERSION\n" },
    check: [{ path: 'src/version.ts', has: ['export const VERSION'] }],
  },
  {
    id: 'todo-comment',
    task: 'In src/todo.ts, replace the TODO comment with a sentence saying the loop is capped at three.',
    files: { 'src/todo.ts': '// TODO: fix later\nexport const limit = 3\n' },
    check: [{ path: 'src/todo.ts', has: ['three'], missing: ['TODO'] }],
  },
  {
    id: 'rename-fmt',
    task: 'Rename fmt to formatTitle in src/fmt.ts and src/app.ts.',
    files: {
      'src/fmt.ts': 'export function fmt(value: string): string {\n  return value.trim()\n}\n',
      'src/app.ts': "import { fmt } from './fmt'\n\nexport const title = fmt('  hi  ')\n",
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
      'src/main.ts': "import { load } from './load'\n\nexport const value = load('a')\n",
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
