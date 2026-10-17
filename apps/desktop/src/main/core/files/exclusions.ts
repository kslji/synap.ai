/**
 * Folders and files the index never reads.
 * System locations, hidden folders, dependency and VCS folders, app bundles,
 * password stores, keychains, browser profiles, SSH keys, and .env-style secrets.
 */
import { baseName, normalizePath, type PathStyle } from './paths.js'

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  '.ssh',
  'keychains',
  'cookies',
])

const SECRET_FILE = new Set([
  '.env',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials.json',
  'secrets.json',
  'service-account.json',
  'login data',
  'logins.json',
  'cookies',
  'web data',
  'key3.db',
  'key4.db',
  'cert9.db',
])

const SECRET_EXT = new Set(['pem', 'key', 'pfx', 'p12', 'kdbx', 'keystore', 'keychain', 'keychain-db'])

const POSIX_SYSTEM = [
  '/system',
  '/library',
  '/usr',
  '/bin',
  '/sbin',
  '/private',
  '/var',
  '/etc',
  '/opt',
  '/applications',
]

const WIN_SYSTEM = [
  'c:/windows',
  'c:/program files',
  'c:/program files (x86)',
  'c:/programdata',
  'c:/$recycle.bin',
  'c:/system volume information',
]

export function isExcluded(filePath: string, style: PathStyle): boolean {
  const norm = normalizePath(filePath, style)
  if (!norm) return true
  const parts = norm.split('/').filter(Boolean)
  if (isSystem(norm, style)) return true
  if (isUserPrivateStore(parts)) return true
  for (let i = 0; i < parts.length; i++) {
    const lower = parts[i].toLowerCase()
    const last = i === parts.length - 1
    if (!last && (lower.startsWith('.') || lower.endsWith('.app') || lower === 'keychains')) return true
    if (SKIP_DIR.has(lower)) return true
  }
  return isSecretFile(baseName(norm))
}

export function isSecretFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (SECRET_FILE.has(lower)) return true
  if (/^\.env$/i.test(lower)) return true
  if (/^\.env\./i.test(lower) && !/^\.env\.(example|sample|template)$/i.test(lower)) return true
  const dot = lower.lastIndexOf('.')
  if (dot > 0 && SECRET_EXT.has(lower.slice(dot + 1))) return true
  if (lower.endsWith('.keychain') || lower.endsWith('.keychain-db')) return true
  return false
}

function isSystem(norm: string, style: PathStyle): boolean {
  const list = style === 'win32' ? WIN_SYSTEM : POSIX_SYSTEM
  const lower = norm.toLowerCase()
  return list.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))
}

/** ~/Library and AppData hold keychains and browser profiles. A project folder named Library is kept. */
function isUserPrivateStore(parts: string[]): boolean {
  const lower = parts.map((part) => part.toLowerCase())
  const users = lower.indexOf('users')
  if (users >= 0 && lower[users + 2] === 'library') return true
  if (lower.includes('appdata')) return true
  return false
}

export function exclusionReason(filePath: string, style: PathStyle): string | null {
  if (!isExcluded(filePath, style)) return null
  return 'That location is excluded. Synap.surf skips system folders, hidden folders, app bundles, and secret-like files.'
}
