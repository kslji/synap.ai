/** Extension (no dot, lower case) to a grammar id. Plain text is the fallback for prose and config. */

const CODE_EXT: Record<string, string> = {
  py: 'python',
  pyi: 'python',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'tsx',
  java: 'java',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
}

const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'rst', 'json', 'yml', 'yaml', 'toml',
  'css', 'scss', 'html', 'htm', 'sh', 'bash', 'zsh', 'sql', 'xml',
  'ini', 'cfg', 'properties', 'gradle', 'csv', 'rb', 'php', 'swift',
  'kt', 'kts', 'scala', 'lua', 'vim', 'el',
])

const TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'justfile', 'gemfile', 'rakefile', 'readme',
])

export function languageFor(name: string): string | null {
  const base = name.split('/').pop() ?? name
  const lower = base.toLowerCase()
  if (TEXT_BASENAMES.has(lower)) return 'plaintext'
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = lower.slice(dot + 1)
  if (CODE_EXT[ext]) return CODE_EXT[ext]
  if (TEXT_EXT.has(ext)) return 'plaintext'
  return null
}

export const GRAMMAR_FILES: Record<string, string> = {
  python: 'tree-sitter-python.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  java: 'tree-sitter-java.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
  c: 'tree-sitter-c.wasm',
  cpp: 'tree-sitter-cpp.wasm',
}
