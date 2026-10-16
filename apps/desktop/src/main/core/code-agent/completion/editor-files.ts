/**
 * Read and save for the built-in editor. Completions do not call save.
 * A path has to stay inside the opened project folder.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { languageFor } from '../../code/languages.js'
import { CODE_LIMITS } from '../../code/limits.js'
import { scanProject } from '../../code/scan.js'
import { resolveInside } from '../paths.js'

export interface EditorFile {
  path: string
  language: string
}

export function listEditorFiles(root: string): EditorFile[] {
  return scanProject(root).files.slice(0, 2000).map((file) => ({
    path: file.rel,
    language: file.language,
  }))
}

export function readEditorFile(root: string, rel: string): { path: string; language: string; text: string } {
  const abs = resolveInside(root, rel)
  if (!abs) throw new Error('That file is outside the project.')
  const info = statSync(abs)
  if (!info.isFile()) throw new Error('Choose a file.')
  if (info.size > CODE_LIMITS.maxFileBytes) throw new Error('That file is too large for the editor.')
  const text = readFileSync(abs, 'utf8')
  const path = relative(root, abs).split(sep).join('/')
  return { path, language: languageFor(path) ?? 'plaintext', text }
}

export function saveEditorFile(root: string, rel: string, text: string): { path: string } {
  const abs = resolveInside(root, rel)
  if (!abs) throw new Error('That file is outside the project.')
  if (!statSync(abs).isFile()) throw new Error('Choose a file.')
  if (Buffer.byteLength(text) > CODE_LIMITS.maxFileBytes) throw new Error('That file is too large for the editor.')
  writeFileSync(abs, text, 'utf8')
  return { path: relative(root, abs).split(sep).join('/') }
}
