/**
 * Languages and libraries for Code-pack retrieval.
 * A shallow scan of the project root. Dependency folders are skipped.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { languageFor } from './code/languages.js'

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'target', 'vendor', '.venv', 'venv', '__pycache__'])

const FRAMEWORKS: Array<{ name: string; library: string; keys: string[] }> = [
  { name: 'react', library: 'react', keys: ['react'] },
  { name: 'next', library: 'nextjs', keys: ['next'] },
  { name: 'express', library: 'express', keys: ['express'] },
  { name: 'jest', library: 'jest', keys: ['jest'] },
  { name: 'vitest', library: 'vitest', keys: ['vitest'] },
  { name: 'django', library: 'django', keys: ['django'] },
  { name: 'fastapi', library: 'fastapi', keys: ['fastapi'] },
  { name: 'flask', library: 'flask', keys: ['flask'] },
  { name: 'pytest', library: 'pytest', keys: ['pytest'] },
]

export interface ProjectStack {
  languages: string[]
  libraries: string[]
}

export function detectProjectStack(root: string): ProjectStack {
  const counts = new Map<string, number>()
  const bump = (language: string) => counts.set(language, (counts.get(language) ?? 0) + 1)
  walk(root, 0, bump)
  if (existsSync(join(root, 'Dockerfile')) || existsSync(join(root, 'dockerfile'))) bump('docker')
  if (existsSync(join(root, 'go.mod'))) bump('go')
  if (existsSync(join(root, 'Cargo.toml'))) bump('rust')
  if (existsSync(join(root, 'pom.xml')) || existsSync(join(root, 'build.gradle')) || existsSync(join(root, 'build.gradle.kts'))) bump('java')
  if ([...names(root)].some((name) => name.endsWith('.csproj'))) bump('csharp')
  const languages = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([language]) => language)
  return { languages, libraries: detectLibraries(root) }
}

export function detectLibraries(root: string): string[] {
  const blob = [
    readIf(join(root, 'package.json')),
    readIf(join(root, 'requirements.txt')),
    readIf(join(root, 'pyproject.toml')),
    readIf(join(root, 'Pipfile')),
  ].join('\n').toLowerCase()
  const found: string[] = []
  for (const item of FRAMEWORKS) {
    if (item.keys.some((key) => blob.includes(key))) found.push(item.library)
  }
  if (existsSync(join(root, 'package.json'))) found.push('npm')
  if (existsSync(join(root, 'requirements.txt')) || existsSync(join(root, 'pyproject.toml'))) found.push('pip')
  if (existsSync(join(root, 'Dockerfile')) || existsSync(join(root, 'dockerfile'))) found.push('docker')
  return [...new Set(found)]
}

function walk(dir: string, depth: number, bump: (language: string) => void): void {
  if (depth > 2) return
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (SKIP.has(name)) continue
    const abs = join(dir, name)
    let info
    try { info = statSync(abs) } catch { continue }
    if (info.isDirectory()) {
      walk(abs, depth + 1, bump)
      continue
    }
    const language = packLanguage(name)
    if (language) bump(language)
  }
}

function packLanguage(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.cs')) return 'csharp'
  if (lower.endsWith('.sql')) return 'sql'
  if (lower.endsWith('.css') || lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'bash'
  if (lower === 'dockerfile') return 'docker'
  const grammar = languageFor(name)
  if (grammar === 'tsx' || grammar === 'typescript') return 'typescript'
  if (grammar === 'javascript') return 'javascript'
  if (grammar === 'python' || grammar === 'go' || grammar === 'rust' || grammar === 'java' || grammar === 'c' || grammar === 'cpp') return grammar
  return null
}

function names(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

function readIf(path: string): string {
  try { return readFileSync(path, 'utf8') } catch { return '' }
}
