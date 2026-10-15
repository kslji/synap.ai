/**
 * Code agent rules. The app ships resources/code/system.md.
 * A project file at .synap/system.md replaces it for that folder.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveInside } from './paths.js'

export const RULES_CHAR_CAP = 4000

export const FALLBACK_RULES = [
  '- Follow the project\'s coding style. Match the names, formatting, and patterns already in the files you change.',
  '- Always split work into small steps. One edit or one command, then look at the result.',
  '- Always run tests after edits. Use the project\'s test command.',
].join('\n')

export interface SystemRules {
  text: string
  source: 'project' | 'bundled'
  path: string
}

export function bundledSystemRulesPath(isPackaged: boolean, resourcesPath: string, appRoot: string): string {
  const packaged = join(resourcesPath, 'code', 'system.md')
  if (isPackaged && existsSync(packaged)) return packaged
  return join(appRoot, 'resources', 'code', 'system.md')
}

export function loadSystemRulesSync(projectRoot: string | null, bundledPath: string): SystemRules {
  if (projectRoot) {
    const override = resolveInside(projectRoot, '.synap/system.md')
    if (override && existsSync(override)) {
      const text = clip(readFileSync(override, 'utf8'))
      if (text) return { text, source: 'project', path: override }
    }
  }
  if (existsSync(bundledPath)) {
    const text = clip(readFileSync(bundledPath, 'utf8'))
    if (text) return { text, source: 'bundled', path: bundledPath }
  }
  return { text: FALLBACK_RULES, source: 'bundled', path: bundledPath }
}

export function codeSystemPrompt(rules: string): string {
  return [
    'You are the Code agent in Synap.surf. You change a local project by calling one tool at a time.',
    'Read the tool result before the next step. End with the finish tool.',
    'Do not claim a file changed until the user applies the diff.',
    '',
    'Tools: read_file, list_dir, search_project, propose_edit, run_command, finish.',
    '',
    'Project rules:',
    rules.trim(),
  ].join('\n')
}

function clip(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim().slice(0, RULES_CHAR_CAP)
}
