/**
 * Path checks that behave the same on macOS and Windows.
 * The host OS does not decide the rules: callers pass the style.
 */

export type PathStyle = 'posix' | 'win32'

export function pathStyleOf(platform: string): PathStyle {
  return platform === 'win32' ? 'win32' : 'posix'
}

/** Forward-slash absolute path. Windows drive letters stay, lower-cased for compare. */
export function normalizePath(input: string, style: PathStyle): string {
  let raw = input.trim().replace(/\\/g, '/')
  if (style === 'win32') raw = raw.replace(/^\/+([A-Za-z]:)/, '$1')
  const drive = style === 'win32' && /^[A-Za-z]:/.test(raw)
  const abs = raw.startsWith('/') || drive
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length > (drive ? 1 : 0)) parts.pop()
      continue
    }
    parts.push(part)
  }
  let out = parts.join('/')
  if (drive) out = out.replace(/^([A-Za-z]:)/, (_m, d: string) => d.toUpperCase())
  else if (abs) out = `/${out}`
  return style === 'win32' ? out.toLowerCase() : out
}

export function isInsideRoot(root: string, target: string, style: PathStyle): boolean {
  const base = normalizePath(root, style)
  const file = normalizePath(target, style)
  if (!base || !file) return false
  return file === base || file.startsWith(`${base}/`)
}

/** ~/Documents when the folder sits under the home directory. */
export function displayPath(filePath: string, home: string, style: PathStyle): string {
  const file = normalizePath(filePath, style)
  const base = normalizePath(home, style)
  if (base && (file === base || file.startsWith(`${base}/`))) {
    const rest = file.slice(base.length)
    return `~${rest}`
  }
  return style === 'win32' ? filePath.replace(/\//g, '\\') : filePath
}

export function baseName(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  const cut = norm.split('/').filter(Boolean)
  return cut[cut.length - 1] ?? filePath
}

export function joinPath(root: string, name: string, style: PathStyle): string {
  const sep = style === 'win32' ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${name}`
}
