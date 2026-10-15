/**
 * Copy tree-sitter WASM grammars into resources/tree-sitter.
 * web-tree-sitter loads these files. No native grammar build is required.
 *
 * Pins (ABI checked with web-tree-sitter 0.27.1):
 *   tree-sitter-python 0.25.0
 *   tree-sitter-javascript 0.25.0
 *   tree-sitter-typescript 0.23.2 (typescript + tsx)
 *   tree-sitter-java 0.23.5
 *   tree-sitter-go 0.25.0
 *   tree-sitter-rust 0.24.0
 *   tree-sitter-c 0.24.1
 *   tree-sitter-cpp 0.23.4
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'tree-sitter')
const packs = [
  ['tree-sitter-python', '0.25.0', ['tree-sitter-python.wasm']],
  ['tree-sitter-javascript', '0.25.0', ['tree-sitter-javascript.wasm']],
  ['tree-sitter-typescript', '0.23.2', ['tree-sitter-typescript.wasm', 'tree-sitter-tsx.wasm']],
  ['tree-sitter-java', '0.23.5', ['tree-sitter-java.wasm']],
  ['tree-sitter-go', '0.25.0', ['tree-sitter-go.wasm']],
  ['tree-sitter-rust', '0.24.0', ['tree-sitter-rust.wasm']],
  ['tree-sitter-c', '0.24.1', ['tree-sitter-c.wasm']],
  ['tree-sitter-cpp', '0.23.4', ['tree-sitter-cpp.wasm']],
]

mkdirSync(root, { recursive: true })
const tmp = join(root, '.tmp')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp)
const lines = []
for (const [name, version, files] of packs) {
  const url = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`
  const tgz = join(tmp, `${name}.tgz`)
  execFileSync('curl', ['-fsSL', url, '-o', tgz], { stdio: 'inherit' })
  execFileSync('tar', ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' })
  for (const file of files) {
    const src = join(tmp, 'package', file)
    const dest = join(root, file)
    execFileSync('cp', [src, dest])
    lines.push(`${name}@${version} ${file}`)
  }
  rmSync(join(tmp, 'package'), { recursive: true, force: true })
}
rmSync(tmp, { recursive: true, force: true })
writeFileSync(join(root, 'SOURCES.txt'), `${lines.join('\n')}\n`)
console.log(`wrote ${lines.length} wasm files to ${root}`)
