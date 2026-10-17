/**
 * Folder grants. Nothing outside an allowed root is readable.
 * Suggestions are labels only: a grant exists after the user picks a folder.
 */
import { exclusionReason, isExcluded } from './exclusions.js'
import { baseName, displayPath, isInsideRoot, joinPath, normalizePath, parentPath, pathStyleOf, type PathStyle } from './paths.js'
import { INDEX_TIME_NOTE } from './suggestions.js'

export type GrantScope = 'once' | 'always'
export type FolderId = 'documents' | 'desktop' | 'downloads'

export interface SuggestedFolder {
  id: string
  label: string
  path: string
  kind?: string
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
  specific: boolean
  note: string | null
}

export interface NamedPlace {
  label: string
  path: string
  broad: boolean
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

const STOP_NAMES = new Set(['file', 'files', 'folder', 'folders', 'document', 'pdf', 'image', 'images', 'note', 'notes', 'this', 'that', 'here', 'there', 'the', 'a', 'an', 'my'])

/** A folder or file the question names. A file becomes its parent folder. */
export function namedTarget(text: string, home: string, style: PathStyle, places: readonly SuggestedFolder[] = []): NamedPlace | null {
  if (/\b(?:whole home(?: folder)?|entire home|my home folder|home folder)\b/i.test(text)) {
    return { label: 'Whole home folder', path: home, broad: true }
  }
  const tilde = /~\/([A-Za-z0-9][^\s"'`<>|]*)/.exec(text)
  if (tilde?.[1]) return placeFromRelative(tilde[1], home, style)
  if (style === 'win32') {
    const win = /([A-Za-z]:[\\/][^\s"'`<>|]*)/.exec(text)
    if (win?.[1]) return placeFromAbsolute(win[1], home, style)
  }
  const phrase = folderPhrase(text)
  if (phrase) return placeFromName(phrase, home, style, places)
  const ranked = [...places]
    .filter((place) => place.kind !== 'home' && baseName(place.path).length >= 3 && !/^whole home/i.test(place.label))
    .sort((a, b) => baseName(b.path).length - baseName(a.path).length)
  for (const place of ranked) {
    const name = baseName(place.path)
    if (STOP_NAMES.has(name.toLowerCase())) continue
    const re = new RegExp(`(?:^|\\b)${escapeReg(name)}(?:\\b|$)`, 'i')
    if (!re.test(text)) continue
    return { label: place.label, path: place.path, broad: place.kind === 'drive' }
  }
  return null
}

export function planAccess(ask: FileAsk, grants: readonly GrantRef[], suggestions: readonly SuggestedFolder[], home: string, style: PathStyle): AccessPlan {
  if (ask.secret) return refuse(secretRefusal())
  const named = namedTarget(ask.query, home, style, suggestions) ?? (ask.folder ? classicPlace(ask.folder, home, style) : null)
  if (named) {
    const blocked = exclusionReason(named.path, style)
    if (blocked) return refuse(blocked)
    const parents = grants.filter((grant) => isInsideRoot(grant.path, named.path, style))
    if (!parents.length) {
      const label = named.label || displayPath(named.path, home, style)
      return {
        action: 'ask',
        roots: [],
        label,
        path: named.path,
        text: permissionQuestion(label),
        specific: true,
        note: named.broad ? INDEX_TIME_NOTE : null,
      }
    }
    return { action: 'search', roots: parents.map((grant) => grant.path), label: named.label, path: named.path, text: '', specific: false, note: null }
  }
  if (!grants.length) {
    return {
      action: 'ask',
      roots: [],
      label: 'a folder you choose',
      path: '',
      text: permissionQuestion('a folder you choose'),
      specific: false,
      note: null,
    }
  }
  return { action: 'search', roots: grants.map((grant) => grant.path), label: '', path: '', text: '', specific: false, note: null }
}

function refuse(text: string): AccessPlan {
  return { action: 'refuse', roots: [], label: '', path: '', text, specific: false, note: null }
}

function classicPlace(id: FolderId, home: string, style: PathStyle): NamedPlace {
  const name = id === 'documents' ? 'Documents' : id === 'desktop' ? 'Desktop' : 'Downloads'
  const path = joinPath(home, name, style)
  return { label: displayPath(path, home, style), path, broad: false }
}

function folderPhrase(text: string): string | null {
  const patterns = [
    /\b(?:in|inside|from|under)\s+(?:the|my)\s+([A-Za-z0-9][\w .'+-]{0,60}?)\s+folder\b/i,
    /\b(?:in|inside|from|under)\s+my\s+([A-Za-z0-9][\w'+.-]{1,60})\b/i,
    /\b(?:in|inside|from|under)\s+([A-Za-z0-9][\w'+.-]{2,60})\s+folder\b/i,
    /\b(?:in|inside|from|under)\s+([A-Za-z][\w'+.-]{2,60})\b/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    const raw = match?.[1]?.trim().replace(/\s+folder$/i, '').trim() ?? ''
    if (!raw || STOP_NAMES.has(raw.toLowerCase())) continue
    if (/\.[A-Za-z0-9]{1,8}$/.test(raw)) continue
    return raw
  }
  return null
}

function placeFromName(raw: string, home: string, style: PathStyle, places: readonly SuggestedFolder[]): NamedPlace {
  const known = places.find((place) => baseName(place.path).toLowerCase() === raw.toLowerCase() && place.kind !== 'home')
  if (known) return { label: known.label, path: known.path, broad: known.kind === 'drive' }
  if (/^(downloads|desktop|documents)$/i.test(raw)) return classicPlace(raw.toLowerCase() as FolderId, home, style)
  const path = joinPath(home, raw, style)
  return { label: displayPath(path, home, style), path, broad: false }
}

function placeFromRelative(rel: string, home: string, style: PathStyle): NamedPlace {
  const parts = rel.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean)
  const full = parts.reduce((acc, part) => joinPath(acc, part, style), home)
  return asFolder(full, home, style)
}

function placeFromAbsolute(raw: string, home: string, style: PathStyle): NamedPlace {
  return asFolder(raw.replace(/\\/g, '/'), home, style)
}

function asFolder(full: string, home: string, style: PathStyle): NamedPlace {
  const name = baseName(full)
  const file = name.includes('.') && name !== '.' && name !== '..'
  const path = file ? parentPath(full, style) : full
  const norm = normalizePath(path, style)
  const broad = style === 'win32' ? /^[a-z]:\/?$/i.test(norm) : norm === normalizePath(home, style)
  const label = broad && style === 'win32' ? `${norm.slice(0, 1).toUpperCase()}:` : displayPath(path, home, style)
  return { label, path, broad }
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function styleForPlatform(platform: string): PathStyle {
  return pathStyleOf(platform)
}
