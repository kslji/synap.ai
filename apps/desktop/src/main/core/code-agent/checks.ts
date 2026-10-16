/**
 * Step checks and the final test command are chosen here.
 * A model command is used only when it is one allow-listed test, typecheck, or lint program.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckKind, StepCheck } from './plan.js'
import { splitCommand } from './workspace.js'

const BINS = new Set([
  'npm', 'pnpm', 'yarn', 'bun',
  'pytest', 'python', 'python3', 'ruff', 'mypy', 'pyright',
  'eslint', 'tsc', 'vitest', 'cargo', 'go', 'make',
])

const NPX_TOOLS = new Set(['tsc', 'eslint', 'vitest', 'pyright', 'ruff'])

export function resolveCheck(root: string, check: StepCheck): { command: string | null; source: 'model' | 'project' | 'none' } {
  if (commandAllowed(check.command, check.kind)) return { command: check.command.trim(), source: 'model' }
  const detected = detectCheck(root, check.kind)
  if (detected) return { command: detected, source: 'project' }
  return { command: null, source: 'none' }
}

export function fullTestCommand(root: string): string | null {
  return detectCheck(root, 'test')
}

export function detectCheck(root: string, kind: CheckKind): string | null {
  const scripts = readScripts(root)
  if (scripts) {
    if (kind === 'test' && scripts.test) return 'npm test'
    if (kind === 'lint' && (scripts.lint || scripts['lint:fix'])) return scripts.lint ? 'npm run lint' : 'npm run lint:fix'
    if (kind === 'typecheck' && (scripts.typecheck || scripts['type-check'] || scripts.check)) {
      if (scripts.typecheck) return 'npm run typecheck'
      if (scripts['type-check']) return 'npm run type-check'
      return 'npm run check'
    }
  }
  if (kind === 'typecheck' && existsSync(join(root, 'tsconfig.json'))) return 'npx tsc --noEmit'
  if (kind === 'lint' && (existsSync(join(root, 'ruff.toml')) || existsSync(join(root, 'pyproject.toml')))) return 'ruff check .'
  if (kind === 'test' && (existsSync(join(root, 'pytest.ini')) || existsSync(join(root, 'pyproject.toml')))) return 'pytest'
  if (kind === 'test' && existsSync(join(root, 'Cargo.toml'))) return 'cargo test'
  if (kind === 'test' && existsSync(join(root, 'go.mod'))) return 'go test ./...'
  if (kind === 'test' && scripts?.test) return 'npm test'
  return null
}

export function commandAllowed(command: string, kind: CheckKind): boolean {
  const split = splitCommand(command)
  if (!split.ok) return false
  if (!kindMatches(kind, command)) return false
  const bin = (split.argv[0] ?? '').split(/[/\\]/).pop() ?? ''
  if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn' || bin === 'bun') return scriptAllowed(split.argv, kind)
  if (bin === 'npx') return NPX_TOOLS.has(split.argv[1] ?? '')
  return BINS.has(bin)
}

function scriptAllowed(argv: string[], kind: CheckKind): boolean {
  const sub = argv[1] ?? ''
  if (sub === 'test') return kind === 'test'
  if (sub !== 'run') return false
  const script = argv[2] ?? ''
  if (kind === 'test') return /test/i.test(script)
  if (kind === 'lint') return /lint/i.test(script)
  return /type|check|tsc/i.test(script)
}

function kindMatches(kind: CheckKind, command: string): boolean {
  const lower = command.toLowerCase()
  if (kind === 'test') return /\b(test|pytest|vitest|jest)\b/.test(lower)
  if (kind === 'typecheck') return /\b(tsc|pyright|mypy|typecheck|type-check|check)\b/.test(lower)
  return /\b(lint|eslint|ruff|clippy)\b/.test(lower)
}

function readScripts(root: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: unknown }
    if (!parsed.scripts || typeof parsed.scripts !== 'object') return null
    const scripts: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed.scripts)) {
      if (typeof value === 'string') scripts[key] = value
    }
    return scripts
  } catch {
    return null
  }
}
