/**
 * tree-sitter (WASM) symbol extraction. One grammar per language, loaded on demand.
 * A language we do not parse, or a file the grammar rejects, becomes plain-text sections.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Language, Parser, type Node as SyntaxNode } from 'web-tree-sitter'
import { CODE_LIMITS } from './limits.js'
import { GRAMMAR_FILES } from './languages.js'

const require = createRequire(import.meta.url)

export type SymbolKind = 'function' | 'class' | 'method' | 'import' | 'type' | 'variable' | 'section'

export interface ExtractedSymbol {
  name: string
  qualified: string
  kind: SymbolKind
  startLine: number
  endLine: number
  signature: string
  parentName: string | null
  text: string
  /** Set when the symbol is an import of another module. */
  module: string | null
}

export interface ExtractedEdge {
  kind: 'calls' | 'imports' | 'references'
  srcQualified: string | null
  dstName: string
  dstModule: string | null
  line: number
}

export interface ParseResult {
  language: string
  symbols: ExtractedSymbol[]
  edges: ExtractedEdge[]
}

interface SymbolRule { type: string; kind: SymbolKind | 'auto'; nameField: string }
interface CallRule { type: string; field: string }
interface LangSpec {
  symbolNodes: SymbolRule[]
  classNodes: string[]
  callNodes: CallRule[]
}

const IDENT = new Set(['identifier', 'type_identifier', 'field_identifier', 'property_identifier'])

const scriptSpec: LangSpec = {
  symbolNodes: [
    { type: 'function_declaration', kind: 'function', nameField: 'name' },
    { type: 'class_declaration', kind: 'class', nameField: 'name' },
    { type: 'method_definition', kind: 'method', nameField: 'name' },
    { type: 'interface_declaration', kind: 'type', nameField: 'name' },
    { type: 'type_alias_declaration', kind: 'type', nameField: 'name' },
    { type: 'enum_declaration', kind: 'type', nameField: 'name' },
    { type: 'method_signature', kind: 'method', nameField: 'name' },
  ],
  classNodes: ['class_declaration', 'interface_declaration'],
  callNodes: [{ type: 'call_expression', field: 'function' }],
}

const SPECS: Record<string, LangSpec> = {
  python: {
    symbolNodes: [
      { type: 'function_definition', kind: 'auto', nameField: 'name' },
      { type: 'class_definition', kind: 'class', nameField: 'name' },
    ],
    classNodes: ['class_definition'],
    callNodes: [{ type: 'call', field: 'function' }],
  },
  javascript: scriptSpec,
  typescript: scriptSpec,
  tsx: scriptSpec,
  java: {
    symbolNodes: [
      { type: 'class_declaration', kind: 'class', nameField: 'name' },
      { type: 'interface_declaration', kind: 'type', nameField: 'name' },
      { type: 'enum_declaration', kind: 'type', nameField: 'name' },
      { type: 'method_declaration', kind: 'method', nameField: 'name' },
      { type: 'constructor_declaration', kind: 'method', nameField: 'name' },
    ],
    classNodes: ['class_declaration', 'interface_declaration', 'enum_declaration'],
    callNodes: [
      { type: 'method_invocation', field: 'name' },
      { type: 'object_creation_expression', field: 'type' },
    ],
  },
  go: {
    symbolNodes: [
      { type: 'function_declaration', kind: 'function', nameField: 'name' },
      { type: 'method_declaration', kind: 'method', nameField: 'name' },
      { type: 'type_spec', kind: 'type', nameField: 'name' },
    ],
    classNodes: ['type_spec'],
    callNodes: [{ type: 'call_expression', field: 'function' }],
  },
  rust: {
    symbolNodes: [
      { type: 'function_item', kind: 'auto', nameField: 'name' },
      { type: 'struct_item', kind: 'class', nameField: 'name' },
      { type: 'enum_item', kind: 'type', nameField: 'name' },
      { type: 'trait_item', kind: 'type', nameField: 'name' },
      { type: 'type_item', kind: 'type', nameField: 'name' },
    ],
    classNodes: ['struct_item', 'enum_item', 'trait_item', 'impl_item'],
    callNodes: [{ type: 'call_expression', field: 'function' }],
  },
  c: {
    symbolNodes: [
      { type: 'function_definition', kind: 'function', nameField: 'declarator' },
      { type: 'struct_specifier', kind: 'class', nameField: 'name' },
      { type: 'enum_specifier', kind: 'type', nameField: 'name' },
    ],
    classNodes: ['struct_specifier'],
    callNodes: [{ type: 'call_expression', field: 'function' }],
  },
  cpp: {
    symbolNodes: [
      { type: 'function_definition', kind: 'auto', nameField: 'declarator' },
      { type: 'class_specifier', kind: 'class', nameField: 'name' },
      { type: 'struct_specifier', kind: 'class', nameField: 'name' },
      { type: 'enum_specifier', kind: 'type', nameField: 'name' },
    ],
    classNodes: ['class_specifier', 'struct_specifier'],
    callNodes: [{ type: 'call_expression', field: 'function' }],
  },
}

let initOnce: Promise<void> | null = null
const loaded = new Map<string, Language>()
let parser: Parser | null = null

function initParser(): Promise<void> {
  if (!initOnce) {
    initOnce = (async () => {
      try {
        await Parser.init()
      } catch {
        const wasm = readFileSync(require.resolve('web-tree-sitter/web-tree-sitter.wasm'))
        await Parser.init({ wasmBinary: wasm })
      }
    })()
  }
  return initOnce
}

async function loadLanguage(language: string, grammarDir: string): Promise<Language | null> {
  const cached = loaded.get(language)
  if (cached) return cached
  const file = GRAMMAR_FILES[language]
  if (!file) return null
  const lang = await Language.load(readFileSync(join(grammarDir, file)))
  loaded.set(language, lang)
  return lang
}

function lineOf(node: SyntaxNode): number { return node.startPosition.row + 1 }
function endLine(node: SyntaxNode): number { return node.endPosition.row + 1 }

function identText(node: SyntaxNode | null): string | null {
  if (!node) return null
  if (IDENT.has(node.type)) return node.text
  const nested = node.childForFieldName('declarator') ?? node.childForFieldName('name')
  if (nested) {
    const inner = identText(nested)
    if (inner) return inner
  }
  const ids = node.descendantsOfType(['identifier', 'type_identifier', 'field_identifier', 'property_identifier'])
  return ids.at(-1)?.text ?? null
}

function fieldText(node: SyntaxNode, field: string): string | null {
  return identText(node.childForFieldName(field))
}

function unquote(text: string): string {
  return text.trim().replace(/^["'`<]+/, '').replace(/[>"'`]+$/, '')
}

function signatureOf(node: SyntaxNode): string {
  const line = node.text.split('\n', 1)[0] ?? ''
  return line.trim().slice(0, 200)
}

function bodyOf(node: SyntaxNode): string {
  const text = node.text
  return text.length > CODE_LIMITS.maxSymbolChars ? text.slice(0, CODE_LIMITS.maxSymbolChars) : text
}

function parentClassName(node: SyntaxNode, spec: LangSpec): string | null {
  let p = node.parent
  while (p) {
    if (spec.classNodes.includes(p.type)) {
      if (p.type === 'impl_item') return fieldText(p, 'type') ?? identText(p.childForFieldName('type'))
      return fieldText(p, 'name')
    }
    p = p.parent
  }
  return null
}

function goReceiver(node: SyntaxNode): string | null {
  const recv = node.childForFieldName('receiver')
  return recv?.descendantsOfType('type_identifier')[0]?.text ?? null
}

function addSymbol(
  symbols: ExtractedSymbol[],
  defined: Set<number>,
  node: SyntaxNode,
  name: string,
  kind: SymbolKind,
  parentName: string | null,
  module: string | null,
): void {
  const nameNode = node.childForFieldName('name') ?? node.descendantsOfType('identifier')[0]
  if (nameNode) defined.add(nameNode.id)
  symbols.push({
    name,
    qualified: parentName ? `${parentName}.${name}` : name,
    kind,
    startLine: lineOf(node),
    endLine: endLine(node),
    signature: signatureOf(node),
    parentName,
    text: bodyOf(node),
    module,
  })
}

function enclosing(node: SyntaxNode, spec: LangSpec): string | null {
  let p = node.parent
  while (p) {
    if (p.type === 'method_declaration' && spec === SPECS.go) {
      const name = fieldText(p, 'name')
      const cls = goReceiver(p)
      if (name) return cls ? `${cls}.${name}` : name
    }
    const rule = spec.symbolNodes.find((item) => item.type === p!.type)
    if (rule) {
      const name = fieldText(p, rule.nameField)
      if (name) {
        const cls = rule.kind === 'class' || rule.kind === 'type' ? null : parentClassName(p, spec)
        return cls ? `${cls}.${name}` : name
      }
    }
    p = p.parent
  }
  return null
}

function insideCallName(node: SyntaxNode, spec: LangSpec): boolean {
  let p: SyntaxNode | null = node.parent
  while (p) {
    const call = spec.callNodes.find((item) => item.type === p!.type)
    if (call) {
      const fn = p.childForFieldName(call.field)
      if (!fn) return false
      return node.startIndex >= fn.startIndex && node.endIndex <= fn.endIndex
    }
    p = p.parent
  }
  return false
}

function pushImport(
  symbols: ExtractedSymbol[],
  edges: ExtractedEdge[],
  node: SyntaxNode,
  local: string,
  module: string,
  original: string,
): void {
  symbols.push({
    name: local,
    qualified: local,
    kind: 'import',
    startLine: lineOf(node),
    endLine: endLine(node),
    signature: signatureOf(node),
    parentName: null,
    text: node.text.split('\n', 1)[0]?.trim().slice(0, 300) ?? local,
    module,
  })
  edges.push({ kind: 'imports', srcQualified: null, dstName: original, dstModule: module, line: lineOf(node) })
}

function fieldNodes(node: SyntaxNode, field: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let i = 0; i < node.childCount; i++) {
    if (node.fieldNameForChild(i) === field) {
      const child = node.child(i)
      if (child) out.push(child)
    }
  }
  return out
}

function extractImports(language: string, root: SyntaxNode, symbols: ExtractedSymbol[], edges: ExtractedEdge[]): void {
  if (language === 'python') {
    for (const node of root.descendantsOfType('import_statement')) {
      for (const name of fieldNodes(node, 'name')) {
        const raw = name.type === 'aliased_import' ? (fieldText(name, 'name') ?? name.text) : name.text
        const alias = name.type === 'aliased_import' ? fieldText(name, 'alias') : null
        const module = raw
        const original = module.split('.').at(-1) ?? module
        pushImport(symbols, edges, node, alias ?? original, module, original)
      }
    }
    for (const node of root.descendantsOfType('import_from_statement')) {
      const module = node.childForFieldName('module_name')?.text ?? ''
      for (const name of fieldNodes(node, 'name')) {
        const raw = name.type === 'aliased_import' ? (fieldText(name, 'name') ?? '') : name.text
        const alias = name.type === 'aliased_import' ? fieldText(name, 'alias') : null
        const original = raw.split('.').at(-1) ?? raw
        if (!original) continue
        pushImport(symbols, edges, node, alias ?? original, module, original)
      }
    }
    return
  }
  if (language === 'javascript' || language === 'typescript' || language === 'tsx') {
    for (const node of root.descendantsOfType('import_statement')) {
      const module = unquote(node.childForFieldName('source')?.text ?? '')
      const clause = node.childForFieldName('source') ? node.namedChildren.find((child) => child.type === 'import_clause') : null
      const specs = node.descendantsOfType('import_specifier')
      if (!specs.length) {
        const local = clause ? (fieldText(clause, 'name') ?? identText(clause) ?? module.split('/').at(-1) ?? module) : (module.split('/').at(-1) ?? module)
        if (local) pushImport(symbols, edges, node, local, module, local)
      }
      for (const spec of specs) {
        const original = fieldText(spec, 'name') ?? identText(spec) ?? ''
        const alias = fieldText(spec, 'alias')
        if (original) pushImport(symbols, edges, node, alias ?? original, module, original)
      }
      const ns = node.descendantsOfType('namespace_import')[0]
      if (ns) {
        const local = identText(ns) ?? '*'
        pushImport(symbols, edges, node, local, module, '*')
      }
    }
    for (const node of root.descendantsOfType('call_expression')) {
      const fn = node.childForFieldName('function')
      if (fn?.text !== 'require') continue
      const arg = node.childForFieldName('arguments')?.descendantsOfType('string')[0]
      if (!arg) continue
      const module = unquote(arg.text)
      const parent = node.parent
      const local = parent?.type === 'variable_declarator' ? fieldText(parent, 'name') : null
      pushImport(symbols, edges, node, local ?? module.split('/').at(-1) ?? module, module, local ?? '*')
    }
    return
  }
  if (language === 'java') {
    for (const node of root.descendantsOfType('import_declaration')) {
      const scoped = node.descendantsOfType('scoped_identifier')[0]
      const module = scoped?.text ?? identText(node) ?? ''
      const original = module.split('.').at(-1) ?? module
      if (original) pushImport(symbols, edges, node, original, module, original)
    }
    return
  }
  if (language === 'go') {
    for (const node of root.descendantsOfType('import_spec')) {
      const module = unquote(node.childForFieldName('path')?.text ?? '')
      const alias = node.childForFieldName('name')?.text
      const original = alias && alias !== '.' && alias !== '_' ? alias : (module.split('/').at(-1) ?? module)
      if (module) pushImport(symbols, edges, node, alias && alias !== '.' && alias !== '_' ? alias : original, module, original)
    }
    return
  }
  if (language === 'rust') {
    for (const node of root.descendantsOfType('use_declaration')) {
      const module = node.childForFieldName('argument')?.text ?? node.text.replace(/^use\s+/, '').replace(/;$/, '')
      const original = module.split('::').at(-1)?.replace(/[{}]/g, '').trim() ?? module
      if (original && original !== '*') pushImport(symbols, edges, node, original, module, original)
    }
    return
  }
  if (language === 'c' || language === 'cpp') {
    for (const node of root.descendantsOfType('preproc_include')) {
      const raw = node.childForFieldName('path')?.text ?? ''
      const module = unquote(raw)
      const original = module.split('/').at(-1) ?? module
      if (original) pushImport(symbols, edges, node, original, module, original)
    }
  }
}

function extractSymbols(language: string, spec: LangSpec, root: SyntaxNode, symbols: ExtractedSymbol[], defined: Set<number>): void {
  for (const rule of spec.symbolNodes) {
    for (const node of root.descendantsOfType(rule.type)) {
      if (rule.type === 'struct_specifier' && !node.childForFieldName('body') && !node.childForFieldName('name')) continue
      if ((rule.type === 'struct_specifier' || rule.type === 'enum_specifier' || rule.type === 'class_specifier') && node.parent?.type === 'function_definition') {
        // A named struct inside a parameter is not a top-level symbol.
      }
      const name = rule.type === 'method_declaration' && language === 'go'
        ? fieldText(node, 'name')
        : fieldText(node, rule.nameField)
      if (!name || name === 'constructor') {
        if (rule.type !== 'constructor_declaration') {
          if (!name) continue
        }
      }
      const resolved = name || fieldText(node, 'name') || ''
      if (!resolved) continue
      let kind: SymbolKind = rule.kind === 'auto' ? 'function' : rule.kind
      let parent = parentClassName(node, spec)
      if (language === 'go' && rule.type === 'method_declaration') parent = goReceiver(node)
      if (language === 'go' && rule.type === 'type_spec') {
        kind = node.descendantsOfType('struct_type').length || node.descendantsOfType('interface_type').length ? 'class' : 'type'
        parent = null
      }
      if (rule.kind === 'auto' && parent) kind = 'method'
      if (rule.kind === 'class' || rule.kind === 'type') parent = null
      if (rule.kind === 'method' && parent) kind = 'method'
      addSymbol(symbols, defined, node, resolved, kind, kind === 'method' ? parent : null, null)
    }
  }
  if (language === 'javascript' || language === 'typescript' || language === 'tsx') {
    for (const node of root.descendantsOfType('variable_declarator')) {
      const value = node.childForFieldName('value')
      if (!value || !['arrow_function', 'function', 'function_expression'].includes(value.type)) continue
      const name = fieldText(node, 'name')
      if (!name) continue
      addSymbol(symbols, defined, node, name, 'function', null, null)
    }
  }
}

function extractCalls(spec: LangSpec, root: SyntaxNode, edges: ExtractedEdge[]): void {
  let count = 0
  for (const rule of spec.callNodes) {
    for (const node of root.descendantsOfType(rule.type)) {
      if (count >= CODE_LIMITS.maxCallsPerFile) return
      const name = identText(node.childForFieldName(rule.field))
      if (!name) continue
      edges.push({ kind: 'calls', srcQualified: enclosing(node, spec), dstName: name, dstModule: null, line: lineOf(node) })
      count++
    }
  }
}

function extractRefs(spec: LangSpec, root: SyntaxNode, edges: ExtractedEdge[], defined: Set<number>): void {
  const nodes = root.descendantsOfType(['identifier', 'type_identifier', 'property_identifier', 'field_identifier'])
  let count = 0
  for (const node of nodes) {
    if (count >= CODE_LIMITS.maxRefsPerFile) return
    if (defined.has(node.id)) continue
    if (node.text.length < 2) continue
    if (node.text === 'self' || node.text === 'this' || node.text === 'cls' || node.text === 'super') continue
    if (insideCallName(node, spec)) continue
    const parent = node.parent
    if (!parent) continue
    if (parent.type.includes('import') || parent.type === 'preproc_include' || parent.type === 'use_declaration') continue
    edges.push({ kind: 'references', srcQualified: enclosing(node, spec), dstName: node.text, dstModule: null, line: lineOf(node) })
    count++
  }
}

export function parsePlain(source: string): ParseResult {
  const lines = source.split('\n')
  const blocks: { startLine: number; endLine: number; text: string }[] = []
  let start = 0
  const push = (end: number) => {
    const text = lines.slice(start, end).join('\n').trim()
    if (text) blocks.push({ startLine: start + 1, endLine: Math.max(start + 1, end), text })
    start = end + 1
  }
  for (let i = 0; i < lines.length; i++) if (lines[i]?.trim() === '' && i > start) push(i)
  push(lines.length)
  const symbols: ExtractedSymbol[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const first = block.text.split('\n')[0]?.trim() ?? 'section'
    const heading = /^(#{1,6})\s+(\S.*)$/.exec(first)
    const next = blocks[i + 1]
    const headingOnly = Boolean(heading) && !block.text.includes('\n') && next
    const text = headingOnly && next ? `${block.text}\n\n${next.text}` : block.text
    const name = (heading ? heading[2] : first).trim().slice(0, 80) || `section ${symbols.length + 1}`
    symbols.push({
      name,
      qualified: name,
      kind: 'section',
      startLine: block.startLine,
      endLine: headingOnly && next ? next.endLine : block.endLine,
      signature: first.slice(0, 200),
      parentName: null,
      text: text.slice(0, CODE_LIMITS.maxSymbolChars),
      module: null,
    })
    if (headingOnly) i++
  }
  return { language: 'plaintext', symbols, edges: [] }
}

export async function parseSource(language: string, source: string, grammarDir: string): Promise<ParseResult> {
  if (language === 'plaintext' || !SPECS[language]) return parsePlain(source)
  try {
    await initParser()
    const lang = await loadLanguage(language, grammarDir)
    if (!lang) return parsePlain(source)
    if (!parser) parser = new Parser()
    parser.setLanguage(lang)
    const tree = parser.parse(source)
    if (!tree) return parsePlain(source)
    try {
      const spec = SPECS[language]!
      const symbols: ExtractedSymbol[] = []
      const edges: ExtractedEdge[] = []
      const defined = new Set<number>()
      extractImports(language, tree.rootNode, symbols, edges)
      extractSymbols(language, spec, tree.rootNode, symbols, defined)
      extractCalls(spec, tree.rootNode, edges)
      extractRefs(spec, tree.rootNode, edges, defined)
      return { language, symbols, edges }
    } finally {
      tree.delete()
    }
  } catch {
    return parsePlain(source)
  }
}
