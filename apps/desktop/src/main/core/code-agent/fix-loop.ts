/**
 * Decide which failures a patch introduced, which were already there,
 * and which lines the model is allowed to see. The model only writes the patch.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { truncateToTokens, type TokenCounter } from '../token-budget.js'
import { diagnosticKey, type Diagnostic } from './diagnostics.js'
import { normPath } from './plan.js'
import { resolveInside } from './paths.js'
import { splitCommand } from './workspace.js'

export const FIX_CONTEXT_TOKENS = 800

export interface Classified {
  fixed: Diagnostic[]
  introduced: Diagnostic[]
  preExisting: Diagnostic[]
  /** Baseline failures that are still in the files this step is allowed to change. */
  inScope: Diagnostic[]
}

export function classifyStep(baseline: readonly Diagnostic[], current: readonly Diagnostic[], stepFiles: readonly string[]): Classified {
  const baseKeys = new Set(baseline.map(diagnosticKey))
  const currentKeys = new Set(current.map(diagnosticKey))
  const introduced = current.filter((item) => !baseKeys.has(diagnosticKey(item)))
  const preExisting = current.filter((item) => baseKeys.has(diagnosticKey(item)) && !inScopeFile(item.file, stepFiles))
  const inScope = current.filter((item) => baseKeys.has(diagnosticKey(item)) && inScopeFile(item.file, stepFiles))
  const fixed = baseline.filter((item) => !currentKeys.has(diagnosticKey(item)))
  return { fixed, introduced, preExisting, inScope }
}

export function inScopeDiagnostics(diagnostics: readonly Diagnostic[], stepFiles: readonly string[]): Diagnostic[] {
  return diagnostics.filter((item) => inScopeFile(item.file, stepFiles))
}

/** A check passes when it adds no failures and no in-scope failure remains. */
export function judgeCheck(report: Classified, commandOk: boolean, parsedCount: number): { ok: boolean; regression: boolean } {
  if (report.introduced.length) return { ok: false, regression: true }
  if (report.inScope.length) return { ok: false, regression: false }
  if (!commandOk && parsedCount === 0) return { ok: false, regression: false }
  return { ok: true, regression: false }
}

export function formatFailureReport(report: Classified): string {
  const line = (item: Diagnostic) => `${item.file}:${item.line}:${item.column} ${item.rule} ${item.message}`.replace(/\s+/g, ' ').trim()
  const list = (items: readonly Diagnostic[]) => items.length ? items.map(line).join('; ') : 'none'
  return [
    `Fixed: ${list(report.fixed)}`,
    `Introduced: ${list(report.introduced)}`,
    `Pre-existing: ${list(report.preExisting)}`,
  ].join('\n')
}

export function hasFailureNews(report: Classified): boolean {
  return report.fixed.length + report.introduced.length + report.preExisting.length > 0
}

export async function fixPromptText(
  root: string,
  report: Classified,
  baselineInScope: readonly Diagnostic[],
  counter: TokenCounter,
  budget: number,
): Promise<string> {
  const parts: string[] = []
  if (report.introduced.length) {
    parts.push('The last patch was rolled back because it introduced new failures.')
    parts.push(await focusedFixText(root, report.introduced, counter, Math.max(32, Math.floor(budget / 2))))
    if (baselineInScope.length) {
      parts.push('Fix the original diagnostics. The file is back to the previous version.')
      parts.push(await focusedFixText(root, baselineInScope, counter, Math.max(32, Math.floor(budget / 2))))
    }
  } else if (report.inScope.length) {
    parts.push('Fix only these diagnostics.')
    parts.push(await focusedFixText(root, report.inScope, counter, budget))
  }
  const text = parts.filter(Boolean).join('\n\n')
  if (!text) return ''
  return truncateToTokens(counter, text, budget)
}

export async function focusedFixText(root: string, diagnostics: readonly Diagnostic[], counter: TokenCounter, budget: number): Promise<string> {
  const blocks: string[] = []
  for (const item of diagnostics.slice(0, 8)) {
    const snippet = readSnippet(root, item.file, item.line, 3)
    blocks.push(`${item.file}:${item.line}:${item.column} ${item.source} ${item.rule} ${item.message}${snippet ? `\n${snippet}` : ''}`)
  }
  return truncateToTokens(counter, blocks.join('\n\n'), budget)
}

/** Run the files a failure touched before the step's full check. Null when the command cannot be narrowed. */
export function narrowCommand(command: string, files: readonly string[], script: string | null = null): string | null {
  const clean = [...new Set(files.map(normPath).filter((file) => file && !/\s/.test(file)))]
  if (!clean.length) return null
  const split = splitCommand(command)
  if (!split.ok) return null
  const argv = split.argv
  const bin = baseName(argv[0] ?? '')
  const sub = argv[1] ?? ''
  if (bin === 'pytest' || bin === 'py.test') return joinArgv([...argv.filter((arg) => arg !== '.'), ...clean])
  if (bin === 'ruff') return joinArgv(['ruff', ...argv.slice(1).filter((arg) => arg !== '.'), ...clean])
  if (bin === 'eslint' || (bin === 'npx' && sub === 'eslint')) return joinArgv([...argv.filter((arg) => arg !== '.'), ...clean])
  if (bin === 'vitest' || bin === 'jest' || (bin === 'npx' && (sub === 'vitest' || sub === 'jest'))) return joinArgv([...argv, ...clean])
  if ((bin === 'npm' || bin === 'pnpm' || bin === 'yarn' || bin === 'bun') && (sub === 'test' || sub === 'run')) {
    if (!script || !/\b(vitest|jest|mocha|pytest|node --test)\b/.test(script)) return null
    if (argv.includes('--')) return null
    return joinArgv([...argv, '--', ...clean])
  }
  if (bin === 'go' && sub === 'test') {
    const dirs = [...new Set(clean.map(goDir))]
    if (dirs.length !== 1) return null
    return `go test ${dirs[0]}`
  }
  if (bin === 'mvn') {
    const tests = clean.map(javaTestName).filter((name): name is string => Boolean(name))
    if (tests.length !== 1) return null
    return joinArgv([...argv.filter((arg) => !arg.startsWith('-Dtest=')), `-Dtest=${tests[0]}`])
  }
  if (bin === 'gradle' || bin === 'gradlew' || bin === 'gradlew.bat') {
    const tests = clean.map(javaTestName).filter((name): name is string => Boolean(name))
    if (tests.length !== 1) return null
    return joinArgv([...argv, '--tests', tests[0] ?? ''])
  }
  return null
}

/** Step files plus a sibling test file that is already in the project. */
export function affectedFiles(root: string, files: readonly string[]): string[] {
  const out: string[] = []
  const push = (file: string) => {
    const norm = normPath(file)
    if (!norm || out.includes(norm)) return
    out.push(norm)
  }
  for (const file of files) {
    push(file)
    for (const candidate of testCandidates(file)) {
      if (existsSync(join(root, candidate))) push(candidate)
    }
  }
  return out
}

function testCandidates(file: string): string[] {
  const norm = normPath(file)
  const stem = stemOf(norm)
  const dir = norm.split('/').slice(0, -1).join('/')
  const py = stem.replace(/^test_/, '').replace(/_test$/, '')
  return [
    norm.replace(/\.tsx?$/, '.test.ts'),
    norm.replace(/\.tsx?$/, '.spec.ts'),
    dir ? `${dir}/${stem}.test.ts` : `${stem}.test.ts`,
    `tests/test_${py}.py`,
    `test/test_${py}.py`,
    `tests/${py}_test.py`,
    norm.replace(/\.go$/, '_test.go'),
  ]
}

function inScopeFile(file: string, stepFiles: readonly string[]): boolean {
  if (!stepFiles.length) return true
  const target = normPath(file)
  const stems = stepFiles.map((item) => stemOf(item))
  const diag = stemOf(target)
  for (const stepFile of stepFiles) {
    const norm = normPath(stepFile)
    if (target === norm || target.endsWith(`/${norm}`) || norm.endsWith(`/${target}`)) return true
  }
  return stems.some((stem) => diag === stem || diag === `${stem}.test` || diag === `${stem}.spec` || diag === `test_${stem}` || diag === `${stem}_test` || stem === `test_${diag}` || stem === `${diag}_test`)
}

function readSnippet(root: string, file: string, line: number, pad: number): string {
  const abs = resolveInside(root, file)
  if (!abs || !existsSync(abs)) return ''
  let text = ''
  try { text = readFileSync(abs, 'utf8') } catch { return '' }
  if (text.includes('\u0000')) return ''
  const rows = text.split(/\r?\n/)
  const start = Math.max(1, line - pad)
  const end = Math.min(rows.length, line + pad)
  return rows.slice(start - 1, end).map((row, index) => `${start + index}|${row}`).join('\n')
}

function stemOf(file: string): string {
  const base = normPath(file).split('/').pop() ?? ''
  return base.replace(/\.(?:test|spec)\.[cm]?[jt]sx?$/i, '').replace(/\.[^.]+$/, '')
}

function goDir(file: string): string {
  const dir = normPath(file).split('/').slice(0, -1).join('/')
  return dir ? `./${dir}` : '.'
}

function javaTestName(file: string): string | null {
  const base = normPath(file).split('/').pop() ?? ''
  if (!/Test\.java$/.test(base)) return null
  return base.replace(/\.java$/, '')
}

function joinArgv(argv: string[]): string {
  return argv.filter(Boolean).join(' ')
}

function baseName(file: string): string {
  return file.split(/[/\\]/).pop() ?? file
}
