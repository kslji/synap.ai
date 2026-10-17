/**
 * Folder grants. Nothing outside an allowed root is readable.
 * Suggestions are labels only: a grant exists after the user picks a folder.
 */
import { exclusionReason, isExcluded } from './exclusions.js'
import { displayPath, isInsideRoot, joinPath, normalizePath, pathStyleOf, type PathStyle } from './paths.js'

export type GrantScope = 'once' | 'always'
export type FolderId = 'documents' | 'desktop' | 'downloads'

export interface SuggestedFolder {
  id: FolderId
  label: string
  path: string
}

export interface GrantRef {
  path: string
  scope: GrantScope
}

export interface FileAsk {
  query: string
  folder: FolderId | null
  secret: boolean
}

export interface AccessPlan {
  action: 'search' | 'ask' | 'refuse'
  roots: string[]
  label: string
  path: string
  text: string
}

const FILE_NOUN = /\b(files?|folders?|pdfs?|docx|xlsx|pptx|csv|spreadsheets?|slides?|resume|cv|documents?|downloads|desktop|images?|png|jpe?g|notes?|invoices?)\b|\.(pdf|docx|xlsx|csv|pptx|png|jpe?g|md|txt|ts|tsx|js|py)\b/i
const ACTION = /\b(find|locate|search|where|which|summarise|summarize|summary|show|open|what|how)\b/i
const WEB = /\b(on the web|search the web|online|internet|google|duckduckgo)\b/i
const CODE_EDIT = /\b(fix|refactor|implement|commit|rename|edit the|write a test|add a function)\b/i
const IN_PROJECT = /\b(this project|the repo|the codebase|in src\/)\b/i
const SECRET = /(?:\.env\b|id_rsa|id_ed25519|\.ssh\b|keychain|password store|credentials\.json)/i

export function suggestedFolders(home: string, style: PathStyle): SuggestedFolder[] {
  const row = (id: FolderId, name: string): SuggestedFolder => ({
    id,
    label: `~/${name}`,
    path: joinPath(home, name, style),
  })
  return [row('documents', 'Documents'), row('desktop', 'Desktop'), row('downloads', 'Downloads')]
}

export function folderHint(text: string): FolderId | null {
  if (/\bdownloads\b/i.test(text)) return 'downloads'
  if (/\bdesktop\b/i.test(text)) return 'desktop'
  if (/\bdocuments\b/i.test(text)) return 'documents'
  return null
}

export function asksForSecrets(text: string): boolean {
  return SECRET.test(text)
}

export function classifyFileAsk(text: string): FileAsk | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (IN_PROJECT.test(trimmed)) return null
  if (WEB.test(trimmed) && !folderHint(trimmed)) return null
  if (asksForSecrets(trimmed)) return { query: trimmed, folder: folderHint(trimmed), secret: true }
  if (CODE_EDIT.test(trimmed) && !folderHint(trimmed)) return null
  if (!FILE_NOUN.test(trimmed) || !ACTION.test(trimmed)) return null
  return { query: trimmed, folder: folderHint(trimmed), secret: false }
}

export function permissionQuestion(label: string): string {
  return `Allow Synap.surf to search ${label}?`
}

export function secretRefusal(): string {
  return 'I will not read .env files, SSH keys, keychains, or other secret-like files. Those stay out of the index, and nothing was opened.'
}

export function canReadPath(filePath: string, roots: readonly string[], style: PathStyle): boolean {
  if (!filePath || isExcluded(filePath, style)) return false
  return roots.some((root) => root && isInsideRoot(root, filePath, style))
}

export function grantAllowed(folder: string, style: PathStyle): { ok: true } | { ok: false; reason: string } {
  const reason = exclusionReason(folder, style)
  if (reason) return { ok: false, reason }
  if (!normalizePath(folder, style)) return { ok: false, reason: 'Choose a folder.' }
  return { ok: true }
}

export function planAccess(ask: FileAsk, grants: readonly GrantRef[], suggestions: readonly SuggestedFolder[], home: string, style: PathStyle): AccessPlan {
  if (ask.secret) {
    return { action: 'refuse', roots: [], label: '', path: '', text: secretRefusal() }
  }
  const hint = ask.folder ? suggestions.find((item) => item.id === ask.folder) ?? null : null
  if (hint) {
    const covered = grants.some((grant) => isInsideRoot(grant.path, hint.path, style) || isInsideRoot(hint.path, grant.path, style))
    if (!covered) {
      return {
        action: 'ask',
        roots: [],
        label: displayPath(hint.path, home, style),
        path: hint.path,
        text: permissionQuestion(displayPath(hint.path, home, style)),
      }
    }
    const roots = grants.filter((grant) => isInsideRoot(grant.path, hint.path, style) || isInsideRoot(hint.path, grant.path, style)).map((grant) => grant.path)
    return { action: 'search', roots, label: hint.label, path: hint.path, text: '' }
  }
  if (!grants.length) {
    const first = suggestions[0]
    const label = first ? displayPath(first.path, home, style) : '~/Documents'
    return {
      action: 'ask',
      roots: [],
      label,
      path: first?.path ?? '',
      text: permissionQuestion(label),
    }
  }
  return { action: 'search', roots: grants.map((grant) => grant.path), label: '', path: '', text: '' }
}

export function styleForPlatform(platform: string): PathStyle {
  return pathStyleOf(platform)
}
