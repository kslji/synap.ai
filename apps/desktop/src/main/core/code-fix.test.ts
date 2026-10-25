import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fileURLToPath } from 'node:url'
import { detectAllowlist, detectCheck, detectProjectChecks } from './code-agent/checks.js'
import { parseCommandDiagnostics, type Diagnostic } from './code-agent/diagnostics.js'
import { affectedFiles, classifyStep, FIX_CONTEXT_TOKENS, fixPromptText, focusedFixText, formatFailureReport, judgeCheck, narrowCommand } from './code-agent/fix-loop.js'
import { runCodeAgent, type CompletionRequest } from './code-agent/loop.js'
import type { PlanFacts } from './code-agent/plan.js'
import { resolveSandbox, runSandboxed, scrubEnv, selectSandbox } from './code-agent/sandbox.js'
import { runSplitTask, type SplitHost } from './code-agent/split.js'
import { WINDOWS_JOB_SCRIPT } from './code-agent/windows-job.js'
import { CodeTrace } from '../../renderer/src/screens/CodeTrace.js'
import { heuristicCounter } from './token-budget.js'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'code-agent/fixtures')

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'surf-fix-'))
}

function fixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8')
}

function pick(items: Diagnostic[], source: Diagnostic['source']): Array<Pick<Diagnostic, 'file' | 'line' | 'column' | 'rule' | 'message'>> {
  return items.filter((item) => item.source === source).map((item) => ({
    file: item.file,
    line: item.line,
    column: item.column,
    rule: item.rule,
    message: item.message,
  }))
}

function facts(files: string[]): PlanFacts {
  return { indexed: true, files, symbols: [], edges: [] }
}

function host(
  root: string,
  project: PlanFacts,
  complete: SplitHost['complete'],
  runCommand: NonNullable<SplitHost['runCommand']>,
  ask: SplitHost['ask'] = async () => ({ allow: true }),
): SplitHost {
  return {
    root,
    facts: project,
    rules: 'Follow the project style.',
    counter: heuristicCounter,
    promptBudget: 2000,
    searchBudget: 400,
    answerTokens: 400,
    mode: 'ask',
    search: { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } },
    complete,
    ask,
    runCommand,
  }
}

function userText(req: CompletionRequest): string {
  const last = req.messages.at(-1)?.content
  return typeof last === 'string' ? last : ''
}

function diag(partial: Partial<Diagnostic> & Pick<Diagnostic, 'file' | 'message'>): Diagnostic {
  return {
    line: partial.line ?? 1,
    column: partial.column ?? 1,
    rule: partial.rule ?? 'error',
    source: partial.source ?? 'tsc',
    ...partial,
  }
}

test('tsc output becomes file, line, column, rule, and message', () => {
  const found = parseCommandDiagnostics('npx tsc --noEmit', fixture('tsc.txt'), '/repo')
  assert.deepEqual(pick(found, 'tsc'), [
    { file: 'src/add.ts', line: 2, column: 10, rule: 'TS2304', message: "Cannot find name 'extra'." },
    { file: 'src/legacy.ts', line: 1, column: 14, rule: 'TS2322', message: "Type 'string' is not assignable to type 'number'." },
    { file: 'src/app.ts', line: 8, column: 3, rule: 'TS2345', message: "Argument of type 'string' is not assignable to parameter of type 'number'." },
  ])
  const rooted = parseCommandDiagnostics('tsc', "/repo/src/add.ts(2,10): error TS2304: Cannot find name 'extra'.", '/repo')
  assert.equal(rooted[0]?.file, 'src/add.ts')
})

test('eslint stylish and unix output keep errors and drop warnings', () => {
  const found = parseCommandDiagnostics('npx eslint .', fixture('eslint.txt'))
  assert.deepEqual(pick(found, 'eslint'), [
    { file: 'src/app.ts', line: 12, column: 5, rule: 'no-undef', message: "'foo' is not defined" },
    { file: 'src/other.ts', line: 3, column: 10, rule: '@typescript-eslint/no-unused-vars', message: "'x' is defined but never used" },
    { file: 'src/unix.ts', line: 4, column: 1, rule: 'no-undef', message: "'bar' is not defined." },
  ])
  assert.equal(found.some((item) => item.rule === 'no-console'), false)
})

test('pytest failures keep the assertion and the failed node', () => {
  const found = parseCommandDiagnostics('pytest', fixture('pytest.txt'))
  assert.deepEqual(pick(found, 'pytest'), [
    { file: 'tests/test_calc.py', line: 4, column: 1, rule: 'AssertionError', message: 'AssertionError: assert add(1, 2) == 3' },
    { file: 'tests/test_legacy.py', line: 1, column: 1, rule: 'FAILED', message: 'AssertionError: legacy is still broken' },
  ])
})

test('ruff codes stay attached to the python file', () => {
  const found = parseCommandDiagnostics('ruff check .', fixture('ruff.txt'))
  assert.deepEqual(pick(found, 'ruff'), [
    { file: 'src/calc.py', line: 2, column: 5, rule: 'F821', message: 'Undefined name `explode`' },
    { file: 'src/calc.py', line: 1, column: 1, rule: 'F401', message: '`os` imported but unused' },
  ])
})

test('pyright and mypy lines are both diagnostics', () => {
  const found = parseCommandDiagnostics('pyright', fixture('pyright.txt'))
  assert.deepEqual(pick(found, 'pyright'), [
    { file: 'src/calc.py', line: 3, column: 12, rule: 'reportGeneralTypeIssues', message: 'Type "str" is not assignable to type "int"' },
    { file: 'src/calc.py', line: 5, column: 5, rule: 'reportUndefinedVariable', message: '"x" is not defined' },
  ])
  assert.deepEqual(pick(found, 'mypy'), [
    { file: 'src/calc.py', line: 3, column: 1, rule: 'return-value', message: 'Incompatible return value type (got "str", expected "int")' },
  ])
})

test('go compiler and test lines become diagnostics', () => {
  const found = parseCommandDiagnostics('go test ./...', fixture('go.txt'))
  assert.deepEqual(pick(found, 'go'), [
    { file: 'main.go', line: 12, column: 5, rule: 'go', message: 'undefined: foo' },
    { file: 'calc_test.go', line: 8, column: 1, rule: 'FAIL', message: 'got 1 want 3' },
  ])
})

test('cargo errors and panics point at the rust file', () => {
  const found = parseCommandDiagnostics('cargo test', fixture('cargo.txt'))
  assert.deepEqual(pick(found, 'cargo'), [
    { file: 'src/lib.rs', line: 4, column: 5, rule: 'E0425', message: 'cannot find value `extra` in this scope' },
    { file: 'src/lib.rs', line: 10, column: 5, rule: 'panic', message: 'assertion `left == right` failed' },
  ])
})

test('vitest stacks are parsed only for a vitest or jest command', () => {
  const found = parseCommandDiagnostics('npx vitest run', fixture('vitest.txt'))
  assert.deepEqual(pick(found, 'vitest'), [
    { file: 'src/add.test.ts', line: 4, column: 12, rule: 'test', message: 'AssertionError: expected 1 to be 3' },
    { file: 'src/add.test.ts', line: 4, column: 16, rule: 'test', message: 'test failed' },
  ])
  assert.equal(parseCommandDiagnostics('npm test', fixture('vitest.txt')).some((item) => item.source === 'vitest'), false)
  assert.deepEqual(parseCommandDiagnostics('npm test', 'BOOM line 3'), [])
})

test('each language folder exposes its test, lint, typecheck, and build commands', () => {
  const root = tempDir()
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', typecheck: 'tsc --noEmit', build: 'tsc' } }))
    writeFileSync(join(root, 'tsconfig.json'), '{}')
    assert.equal(detectCheck(root, 'test'), 'npm test')
    assert.equal(detectCheck(root, 'lint'), 'npm run lint')
    assert.equal(detectCheck(root, 'typecheck'), 'npm run typecheck')
    const js = detectProjectChecks(root)
    assert.ok(js.some((item) => item.language === 'javascript' && item.kind === 'build' && item.command === 'npm run build'))

    const py = tempDir()
    writeFileSync(join(py, 'pytest.ini'), '[pytest]\n')
    writeFileSync(join(py, 'ruff.toml'), '')
    writeFileSync(join(py, 'pyrightconfig.json'), '{}')
    assert.equal(detectCheck(py, 'test'), 'pytest')
    assert.equal(detectCheck(py, 'lint'), 'ruff check .')
    assert.equal(detectCheck(py, 'typecheck'), 'pyright')
    rmSync(py, { recursive: true, force: true })

    const typed = tempDir()
    writeFileSync(join(typed, 'mypy.ini'), '[mypy]\n')
    assert.equal(detectCheck(typed, 'typecheck'), 'mypy .')
    rmSync(typed, { recursive: true, force: true })

    const jest = tempDir()
    writeFileSync(join(jest, 'jest.config.js'), 'module.exports = {}\n')
    assert.equal(detectCheck(jest, 'test'), 'npx jest')
    assert.equal(detectAllowlist(jest).includes('npx jest'), false)
    rmSync(jest, { recursive: true, force: true })

    const go = tempDir()
    writeFileSync(join(go, 'go.mod'), 'module example.com/demo\n\ngo 1.22\n')
    assert.deepEqual(detectProjectChecks(go).map((item) => item.command), ['go test ./...', 'go vet ./...', 'go build'])
    rmSync(go, { recursive: true, force: true })

    const rust = tempDir()
    writeFileSync(join(rust, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n')
    assert.ok(detectProjectChecks(rust).some((item) => item.language === 'rust' && item.command === 'cargo test'))
    assert.ok(detectProjectChecks(rust).some((item) => item.command === 'cargo check'))
    rmSync(rust, { recursive: true, force: true })

    const maven = tempDir()
    writeFileSync(join(maven, 'pom.xml'), '<project></project>\n')
    assert.equal(detectCheck(maven, 'test'), 'mvn -q test')
    assert.ok(detectProjectChecks(maven).some((item) => item.language === 'java' && item.command === 'mvn -q -DskipTests package'))
    rmSync(maven, { recursive: true, force: true })

    const gradle = tempDir()
    writeFileSync(join(gradle, 'build.gradle'), '')
    writeFileSync(join(gradle, 'gradlew'), '#!/bin/sh\n')
    assert.equal(detectCheck(gradle, 'test'), './gradlew test')
    assert.ok(detectProjectChecks(gradle).some((item) => item.command === './gradlew build'))
    rmSync(gradle, { recursive: true, force: true })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('sandbox choice names the OS helper and says when network stays open', () => {
  assert.equal(selectSandbox('darwin', { sandboxExec: true, bwrap: false, unshare: false }).kind, 'macos-sandbox-exec')
  assert.match(selectSandbox('darwin', { sandboxExec: true, bwrap: false, unshare: false }).note, /best-effort/)
  assert.equal(selectSandbox('linux', { sandboxExec: false, bwrap: true, unshare: true }).kind, 'linux-bwrap')
  assert.match(selectSandbox('linux', { sandboxExec: false, bwrap: true, unshare: true }).note, /unshare-net/)
  assert.equal(selectSandbox('linux', { sandboxExec: false, bwrap: false, unshare: true }).kind, 'linux-unshare')
  assert.equal(selectSandbox('win32', { sandboxExec: false, bwrap: false, unshare: false }).kind, 'windows-job')
  assert.match(selectSandbox('win32', { sandboxExec: false, bwrap: false, unshare: false }).note, /Network is not isolated/)
  assert.match(selectSandbox('linux', { sandboxExec: false, bwrap: false, unshare: false }).note, /Network was not disabled/)
  assert.match(WINDOWS_JOB_SCRIPT, /CreateJobObject/)
  assert.match(WINDOWS_JOB_SCRIPT, /0x2000/)
  assert.ok(WINDOWS_JOB_SCRIPT.indexOf('AssignProcessToJobObject') < WINDOWS_JOB_SCRIPT.indexOf('BeginOutputReadLine'))
  const live = resolveSandbox()
  assert.match(live.note, /best-effort/)
  if (live.kind === 'fallback') assert.match(live.note, /Network was not disabled/)
  if (live.kind === 'linux-unshare') assert.match(live.note, /unshare --net/)
  if (live.kind === 'windows-job') assert.match(live.note, /Network is not isolated/)
})

test('scrubbed environment keeps PATH and drops secrets', () => {
  const env = scrubEnv({
    PATH: '/usr/bin',
    HOME: '/home/dev',
    SECRET_TOKEN: 'super-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    NPM_TOKEN: 'npm-secret',
    LANG: 'C',
  })
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.HOME, '/home/dev')
  assert.equal(env.LANG, 'C')
  assert.equal('SECRET_TOKEN' in env, false)
  assert.equal('AWS_SECRET_ACCESS_KEY' in env, false)
  assert.equal('NPM_TOKEN' in env, false)
})

test('the sandbox locks cwd, caps output, kills the process tree, and hides secrets', async () => {
  const root = tempDir()
  const marker = join(root, 'alive.txt')
  try {
    const cwd = await runSandboxed({
      cwd: root,
      command: 'node -e \'process.stdout.write(process.cwd())\'',
      kind: 'fallback',
      timeoutMs: 5000,
    })
    assert.equal(cwd.ok, true)
    assert.equal(cwd.output, realpathSync(root))
    assert.match(cwd.note, /best-effort/)

    const leaked = await runSandboxed({
      cwd: root,
      command: 'node -e \'process.stdout.write([process.env.SECRET_TOKEN, process.env.AWS_SECRET_ACCESS_KEY, process.env.PATH?"yes":"no"].join(","))\'',
      kind: 'fallback',
      timeoutMs: 5000,
      env: { PATH: process.env.PATH ?? '', SECRET_TOKEN: 'super-secret', AWS_SECRET_ACCESS_KEY: 'aws-secret', HOME: '/tmp' },
    })
    assert.equal(leaked.output, ',,yes')

    const capped = await runSandboxed({
      cwd: root,
      command: 'node -e \'process.stdout.write("x".repeat(200000))\'',
      kind: 'fallback',
      outputCap: 100,
      timeoutMs: 3000,
    })
    assert.equal(capped.truncated, true)
    assert.equal(capped.killed, true)
    assert.match(capped.output, /\[output truncated\]/)
    assert.ok(capped.output.length < 200)

    const shell = await runSandboxed({ cwd: root, command: 'npm test && rm -rf /', kind: 'fallback' })
    assert.equal(shell.ok, false)
    assert.match(shell.output, /shell syntax/)

    writeFileSync(join(root, 'child.js'), 'setInterval(() => require("node:fs").appendFileSync(process.argv[2], "c"), 20)\n')
    writeFileSync(join(root, 'parent.js'), [
      'const { spawn } = require("node:child_process")',
      'const fs = require("node:fs")',
      'const marker = process.argv[2]',
      'fs.writeFileSync(marker, "start")',
      'spawn(process.execPath, [process.argv[3], marker], { stdio: "ignore" })',
      'setInterval(() => fs.appendFileSync(marker, "p"), 20)',
      '',
    ].join('\n'))
    const timed = await runSandboxed({
      cwd: root,
      command: 'node parent.js alive.txt child.js',
      kind: 'fallback',
      timeoutMs: 700,
    })
    assert.equal(timed.timedOut, true)
    assert.equal(timed.killed, true)
    assert.match(timed.output, /\[timed out\]/)
    assert.equal(statSync(marker).isFile(), true)
    const first = statSync(marker).size
    await new Promise((resolve) => setTimeout(resolve, 250))
    const second = statSync(marker).size
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal(statSync(marker).size, first)
    assert.equal(second, first)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('baseline diff keeps unrelated failures and treats a new diagnostic as a regression', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'tests'), { recursive: true })
  writeFileSync(join(root, 'src/calc.py'), 'def add(a, b):\n    return a - b\n')
  writeFileSync(join(root, 'tests/test_calc.py'), 'def test_add():\n    assert add(1, 2) == 3\n')
  const baseline = [
    diag({ file: 'tests/test_calc.py', line: 2, message: 'assert add(1, 2) == 3', rule: 'AssertionError', source: 'pytest' }),
    diag({ file: 'tests/test_legacy.py', line: 2, message: 'legacy is still broken', rule: 'AssertionError', source: 'pytest' }),
  ]
  const current = [
    diag({ file: 'src/calc.py', line: 2, column: 5, message: 'Undefined name `explode`', rule: 'F821', source: 'ruff' }),
    diag({ file: 'tests/test_legacy.py', line: 2, message: 'legacy is still broken', rule: 'AssertionError', source: 'pytest' }),
  ]
  const report = classifyStep(baseline, current, ['src/calc.py'])
  assert.equal(report.introduced.length, 1)
  assert.equal(report.introduced[0]?.rule, 'F821')
  assert.equal(report.preExisting[0]?.file, 'tests/test_legacy.py')
  assert.equal(report.fixed[0]?.file, 'tests/test_calc.py')
  assert.deepEqual(judgeCheck(report, false, current.length), { ok: false, regression: true })
  const same = classifyStep(baseline, baseline, ['src/calc.py'])
  assert.equal(same.inScope[0]?.file, 'tests/test_calc.py')
  assert.equal(same.preExisting[0]?.file, 'tests/test_legacy.py')
  assert.deepEqual(judgeCheck(same, false, baseline.length), { ok: false, regression: false })
  const prompt = await fixPromptText(root, report, [baseline[0]!], heuristicCounter, FIX_CONTEXT_TOKENS)
  assert.match(prompt, /rolled back/)
  assert.match(prompt, /F821/)
  assert.match(prompt, /test_calc\.py/)
  assert.equal(prompt.includes('test_legacy'), false)
  assert.equal(narrowCommand('pytest', affectedFiles(root, ['src/calc.py'])), 'pytest src/calc.py tests/test_calc.py')
  assert.equal(narrowCommand('npm run typecheck', ['src/add.ts'], 'tsc --noEmit'), null)
  assert.equal(narrowCommand('go test ./...', ['main.go']), 'go test .')
  const long = await focusedFixText(root, [diag({ file: 'src/calc.py', line: 1, message: 'x'.repeat(4000), source: 'ruff' })], heuristicCounter, 40)
  assert.ok(long.length < 200)
  assert.match(long, /…/)
  assert.match(formatFailureReport(report), /Introduced:/)
})

test('a regression is rolled back and the next patch sees the restored file', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  const add = join(root, 'src/add.ts')
  writeFileSync(add, 'export function add(a: number, b: number): number {\n  return a + b + extra\n}\n')
  writeFileSync(join(root, 'src/legacy.ts'), "export const legacy: number = 'old'\n")
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }))
  const prompts: string[] = []
  const outputs: string[] = []
  let rolledBack = false
  try {
    const result = await runSplitTask('Fix the type error in src/add.ts and leave src/legacy.ts alone', {
      ...host(root, facts(['src/add.ts', 'src/legacy.ts']), async (req) => {
        const user = userText(req)
        if (user.includes('Kind: plan')) {
          return { content: JSON.stringify({ steps: [{ id: 's1', goal: 'repair add', files: ['src/add.ts'], symbols: [], depends_on: [], check: { kind: 'typecheck', command: '' }, create: false }] }) }
        }
        prompts.push(user)
        if (user.includes('rolled back')) rolledBack = readFileSync(add, 'utf8').includes('extra') && !readFileSync(add, 'utf8').includes('worse')
        if (user.includes('TS2304') || user.includes('rolled back')) {
          return { content: JSON.stringify({ edits: [{ path: 'src/add.ts', old: 'return a + b + extra', new: 'return a + b' }] }) }
        }
        return { content: JSON.stringify({ edits: [{ path: 'src/add.ts', old: 'return a + b + extra', new: 'return a + b + worse' }] }) }
      }, async (_command, _signal, hooks) => {
        const text = readFileSync(add, 'utf8')
        const lines: string[] = []
        if (text.includes('worse')) lines.push("src/add.ts(2,10): error TS2322: Type 'string' is not assignable to type 'number'.")
        else if (text.includes('extra')) lines.push("src/add.ts(2,10): error TS2304: Cannot find name 'extra'.")
        if (readFileSync(join(root, 'src/legacy.ts'), 'utf8').includes("'old'")) {
          lines.push("src/legacy.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.")
        }
        const output = lines.join('\n')
        hooks?.onOutput?.(output.slice(0, 12))
        return { ok: lines.length === 0, output }
      }),
      onStep(step) {
        if (step.output) outputs.push(step.output)
      },
    })
    assert.equal(rolledBack, true)
    assert.equal(result.stopped, 'finish')
    assert.equal(result.attempts[0]?.tries, 2)
    assert.match(readFileSync(add, 'utf8'), /return a \+ b\n/)
    assert.equal(readFileSync(add, 'utf8').includes('extra'), false)
    assert.match(readFileSync(join(root, 'src/legacy.ts'), 'utf8'), /'old'/)
    assert.ok(prompts.some((item) => item.includes('TS2304')))
    assert.ok(prompts.every((item) => !item.includes('src/legacy.ts')))
    assert.match(result.answer, /Introduced: none/)
    assert.match(result.answer, /Pre-existing:/)
    assert.match(result.answer, /src\/legacy\.ts/)
    assert.match(result.answer, /Fixed:/)
    assert.ok(result.steps.some((step) => step.attempt === 2 && step.attempts === 3))
    assert.ok(result.steps.some((step) => step.diagnostics?.some((item) => item.file === 'src/legacy.ts')))
    assert.ok(outputs.some((item) => item.length > 0))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ask mode does not run a check until it is approved, and auto runs an allow-listed check', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'src/b.ts'), 'export const m = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"', typecheck: 'tsc --noEmit' } }))
  const ran: string[] = []
  const plan = (check: { kind: 'test' | 'typecheck'; command: string }) => ({ content: JSON.stringify({ steps: [{ id: 's1', goal: 'bump n', files: ['src/a.ts'], symbols: [], depends_on: [], check, create: false }] }) })
  try {
    const denied = await runSplitTask('Fix the typo in src/a.ts and src/b.ts', host(root, facts(['src/a.ts', 'src/b.ts']), async (req) => {
      const user = userText(req)
      if (user.includes('Kind: plan')) return plan({ kind: 'typecheck', command: '' })
      return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 2' }] }) }
    }, async (command) => {
      ran.push(command)
      return { ok: true, output: 'ok' }
    }, async () => ({ allow: false })))
    assert.equal(denied.stopped, 'cancelled')
    assert.equal(ran.length, 0)
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 1\n')

    const asked: string[] = []
    const auto = await runSplitTask('Fix the typo in src/a.ts and src/b.ts', {
      ...host(root, facts(['src/a.ts', 'src/b.ts']), async (req) => {
        const user = userText(req)
        if (user.includes('Kind: plan')) return plan({ kind: 'test', command: '' })
        return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 2' }] }) }
      }, async (command) => {
        ran.push(command)
        return { ok: true, output: 'ok' }
      }, async (request) => {
        asked.push(request.command ?? request.kind)
        return { allow: false }
      }),
      mode: 'auto',
      commandAllowlist: ['npm test'],
    })
    assert.equal(auto.stopped, 'finish')
    assert.ok(ran.includes('npm test'))
    assert.equal(asked.includes('npm test'), false)
    assert.equal(asked.includes('edit'), false)

    let toolRan = false
    await runCodeAgent('go', {
      root,
      rules: '',
      counter: heuristicCounter,
      promptBudget: 1000,
      searchBudget: 100,
      answerTokens: 100,
      mode: 'ask',
      search: { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } },
      async complete() {
        if (!toolRan) return { content: JSON.stringify({ tool: 'run_command', arguments: { command: 'npm test' } }) }
        return { content: '{"tool":"finish","arguments":{"summary":"Done."}}' }
      },
      async ask() { return { allow: false } },
      async runCommand() {
        toolRan = true
        return { ok: true, output: 'ok' }
      },
    })
    assert.equal(toolRan, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the trace shows live output, diagnostics, and the attempt counter', () => {
  const html = renderToStaticMarkup(createElement(CodeTrace, {
    messageId: '11111111-1111-4111-8111-111111111111',
    diffs: [],
    steps: [{
      id: 'edit:check',
      index: 1,
      tool: 'check',
      status: 'error',
      title: 'Check typecheck',
      detail: 'npm run typecheck',
      output: "src/add.ts(2,10): error TS2304: Cannot find name 'extra'.",
      diagnostics: [{ file: 'src/add.ts', line: 2, column: 10, message: "Cannot find name 'extra'.", rule: 'TS2304', source: 'tsc' }],
      attempt: 1,
      attempts: 3,
      note: 'Network was not disabled. This is best-effort.',
    }],
  }))
  assert.match(html, /data-code-attempt="1"/)
  assert.match(html, /Attempt 1 of 3/)
  assert.match(html, /data-code-output="yes"/)
  assert.match(html, /TS2304/)
  assert.match(html, /data-code-diagnostics="yes"/)
  assert.match(html, /src\/add\.ts:2:10/)
  assert.match(html, /data-code-sandbox="yes"/)
  assert.match(html, /Network was not disabled/)
})
