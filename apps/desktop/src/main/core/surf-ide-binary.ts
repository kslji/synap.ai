/**
 * Where the packaged Surf IDE binary lives, if the user built one.
 *
 * `gulp vscode-darwin-arm64` / `vscode-win32-x64` emit a platform bundle next
 * to the fork checkout; a production install puts the same app under
 * `process.resourcesPath` (packaged) or the system Programs/Applications
 * location. The desktop shell prefers the freshest thing that exists —
 * resourcesPath, then the fork's `.build`, then the installed copy — and
 * returns null otherwise so the caller falls back to the dev `code.sh` /
 * `code.bat` launcher. Primitives are injected so both platforms are testable
 * without touching a real disk.
 */

export type SurfIdePlatform = 'darwin' | 'win32' | string

export interface SurfIdeBinaryInput {
  /** The surf-ide/code-oss checkout root. */
  forkRoot: string
  platform: SurfIdePlatform
  env: NodeJS.ProcessEnv
  resourcesPath?: string
  exists: (p: string) => boolean
  /** product.json's `nameLong`; the caller reads it, tests pass a constant. */
  appName?: string
}

/** The product name baked into the bundle layout; product.json wins when set. */
export function surfIdeAppName(productJsonName?: unknown): string {
  return typeof productJsonName === 'string' && productJsonName.trim() ? productJsonName.trim() : 'Surf IDE'
}

export function resolveSurfIdeBinary(input: SurfIdeBinaryInput): string | null {
  const { forkRoot, platform, env, resourcesPath, exists } = input
  const appName = surfIdeAppName(input.appName)
  const sep = platform === 'win32' ? '\\' : '/'
  const join = (...parts: string[]): string =>
    parts
      .map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '')))
      .filter((p) => p.length > 0)
      .join(sep)

  const candidates: string[] = []
  if (platform === 'win32') {
    // Packaged Electron app dir, the fork's own build output, then the
    // per-user install electron-builder writes for `--win nsis`.
    if (resourcesPath) {
      candidates.push(join(resourcesPath, appName, `${appName}.exe`))
      candidates.push(join(resourcesPath, `${appName}.exe`))
    }
    candidates.push(join(forkRoot, '.build', 'win32-x64', appName, `${appName}.exe`))
    candidates.push(join(forkRoot, '.build', 'win32-x64', `${appName}.exe`))
    const localAppData = env.LOCALAPPDATA
    if (localAppData) {
      candidates.push(join(localAppData, 'Programs', appName, `${appName}.exe`))
    }
  } else if (platform === 'darwin') {
    if (resourcesPath) {
      candidates.push(join(resourcesPath, `${appName}.app`, 'Contents', 'MacOS', appName))
    }
    candidates.push(join(forkRoot, '.build', 'darwin', `${appName}.app`, 'Contents', 'MacOS', appName))
    candidates.push(join(forkRoot, '.build', 'darwin-arm64', `${appName}.app`, 'Contents', 'MacOS', appName))
    candidates.push(join(forkRoot, '.build', 'darwin-x64', `${appName}.app`, 'Contents', 'MacOS', appName))
    candidates.push(join('/Applications', `${appName}.app`, 'Contents', 'MacOS', appName))
  } else {
    return null
  }

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate
    }
  }
  return null
}
