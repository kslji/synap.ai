/** Caps for the Code agent's local project index. Tuned for a laptop, not a build server. */

export const CODE_LIMITS = {
  /** Skip a source file larger than this. Minified bundles and generated dumps stay out. */
  maxFileBytes: 512 * 1024,
  /** Stop walking after this many source files. */
  maxFiles: 20_000,
  /** Stop walking after this many source bytes have been accepted. */
  maxTotalBytes: 80 * 1024 * 1024,
  /** Symbol body stored for snippets. Larger symbols are split into search chunks. */
  maxSymbolChars: 12_000,
  /** One symbol chunk, in words. Overlap keeps a function head with the next slice. */
  chunkWords: 250,
  chunkOverlapWords: 40,
  /** Identifier references recorded per file before the name filter. */
  maxRefsPerFile: 2_000,
  maxCallsPerFile: 2_000,
  embedBatch: 16,
  /** A line this long is treated as minified and the file is skipped. */
  maxLineChars: 8_000,
} as const

/** Directory basenames that are dependencies or build output, even when .gitignore forgets them. */
export const SKIP_DIR_NAMES = new Set([
  '.git', '.svn', '.hg',
  'node_modules', 'bower_components',
  'dist', 'build', 'out', 'target',
  '__pycache__', '.venv', 'venv', '.tox',
  'coverage', '.next', '.nuxt', '.cache',
  '.gradle', '.idea', '.vs',
  'cmake-build-debug', 'DerivedData',
])

export const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tif', 'tiff',
  'pdf', 'zip', 'gz', 'tgz', 'bz2', '7z', 'rar', 'xz',
  'wasm', 'exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'lib', 'obj',
  'class', 'jar', 'war', 'pyc', 'pyo',
  'sqlite', 'db', 'mp3', 'mp4', 'mov', 'avi', 'webm',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'psd', 'ai', 'sketch', 'lock',
])

/** Names that are secrets or tool caches, not source. */
export const SKIP_FILE_NAMES = new Set([
  '.env',
  '.ds_store',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'go.sum',
])

export function isSecretName(name: string): boolean {
  const lower = name.toLowerCase()
  if (SKIP_FILE_NAMES.has(lower)) return true
  if (lower === '.env' || lower.startsWith('.env.')) return true
  if (lower.endsWith('.pem') || lower.endsWith('.key')) return true
  return false
}
