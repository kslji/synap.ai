/**
 * Function-level chunks from tree-sitter WASM. Regex remains the fallback
 * when a grammar cannot be loaded.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname } from 'node:path'
import { Language, Parser } from 'web-tree-sitter'
import { chunkSource, indexProject, type SymbolChunk } from './code-tools.js'

const require = createRequire(import.meta.url)

const FUN = new Set([
  'function_declaration',
  'function_definition',
  'method_definition',
  'class_declaration',
  'class_definition',
  'arrow_function',
])

let ready: Promise<Map<string, Language>> | null = null

function grammar(ext: string): string | null {
  if (ext === '.py') return require.resolve('tree-sitter-python/tree-sitter-python.wasm')
  if (ext === '.tsx' || ext === '.jsx') return require.resolve('tree-sitter-typescript/tree-sitter-tsx.wasm')
  if (ext === '.ts') return require.resolve('tree-sitter-typescript/tree-sitter-typescript.wasm')
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm')
  return null
}

async function languages(): Promise<Map<string, Language>> {
  ready ??= (async () => {
    await Parser.init()
    const map = new Map<string, Language>()
    for (const [ext, file] of [
      ['.ts', grammar('.ts')],
      ['.tsx', grammar('.tsx')],
      ['.js', grammar('.js')],
      ['.py', grammar('.py')],
    ] as const) {
      if (!file) continue
      map.set(ext, await Language.load(file))
    }
    map.set('.jsx', map.get('.tsx')!)
    map.set('.mjs', map.get('.js')!)
    return map
  })()
  return ready
}

function nameOf(node: { type: string; childForFieldName?: (name: string) => { text: string } | null; parent: { type: string; childForFieldName?: (name: string) => { text: string } | null } | null; text: string }): string {
  const named = node.childForFieldName?.('name')
  if (named?.text) return named.text
  if (node.type === 'arrow_function' && node.parent?.type === 'variable_declarator') {
    return node.parent.childForFieldName?.('name')?.text ?? 'arrow'
  }
  const match = node.text.match(/(?:function|class|def|fn)\s+([A-Za-z_][\w]*)/)
  return match?.[1] ?? node.type
}

export async function chunkWithTreeSitter(path: string, text: string): Promise<{ engine: 'tree-sitter' | 'regex'; chunks: SymbolChunk[] }> {
  const ext = extname(path).toLowerCase()
  try {
    const lang = (await languages()).get(ext)
    if (!lang) return { engine: 'regex', chunks: chunkSource(path, text) }
    const parser = new Parser()
    parser.setLanguage(lang)
    const tree = parser.parse(text)
    if (!tree) return { engine: 'regex', chunks: chunkSource(path, text) }
    const chunks: SymbolChunk[] = []
    const walk = (node: typeof tree.rootNode) => {
      if (FUN.has(node.type)) {
        const name = nameOf(node as unknown as Parameters<typeof nameOf>[0])
        chunks.push({ path, name, kind: node.type, text: node.text })
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child) walk(child)
      }
    }
    walk(tree.rootNode)
    parser.delete()
    tree.delete()
    if (!chunks.length) return { engine: 'regex', chunks: chunkSource(path, text) }
    return { engine: 'tree-sitter', chunks }
  } catch {
    return { engine: 'regex', chunks: chunkSource(path, text) }
  }
}

export async function indexProjectAst(root: string, limit = 80): Promise<SymbolChunk[]> {
  const rough = indexProject(root, limit)
  const paths = [...new Set(rough.map((chunk) => chunk.path))]
  const chunks: SymbolChunk[] = []
  for (const path of paths) {
    if (chunks.length >= limit) break
    try {
      const parsed = await chunkWithTreeSitter(path, readFileSync(path, 'utf8'))
      chunks.push(...parsed.chunks)
    } catch { /* unreadable files are skipped */ }
  }
  return chunks.slice(0, limit)
}
