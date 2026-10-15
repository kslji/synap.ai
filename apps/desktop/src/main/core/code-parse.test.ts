import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseSource } from './code/parse.js'
import { scanProject } from './code/scan.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/tree-sitter')

const samples: { language: string; source: string; fn: string; type: string; call: string; imported: string }[] = [
  {
    language: 'python',
    source: 'import os\nfrom pkg.mod import helper\n\ndef greet(name):\n    return helper(name)\n\nclass Box:\n    def open(self, x):\n        greet(x)\n',
    fn: 'greet', type: 'Box', call: 'helper', imported: 'os',
  },
  {
    language: 'javascript',
    source: "import { read } from './io.js'\nexport function greet(name) { return read(name) }\nexport class Box { open(x) { greet(x) } }\nconst arrow = (n) => n + 1\n",
    fn: 'greet', type: 'Box', call: 'read', imported: 'read',
  },
  {
    language: 'typescript',
    source: "import type { User } from './user'\nexport interface Repo { save(u: User): void }\nexport class Store { save(u: User) { return persist(u) } }\nexport function load(id: string) { return null }\n",
    fn: 'load', type: 'Store', call: 'persist', imported: 'User',
  },
  {
    language: 'tsx',
    source: 'export function Button() { return click() }\nexport class Panel { render() { return Button() } }\n',
    fn: 'Button', type: 'Panel', call: 'click', imported: '',
  },
  {
    language: 'java',
    source: 'import app.util.Helper;\npublic class Box {\n  public int open(int x) { return Helper.go(x); }\n}\n',
    fn: 'open', type: 'Box', call: 'go', imported: 'Helper',
  },
  {
    language: 'go',
    source: 'package app\nimport "fmt"\nfunc Greet(name string) string { return fmt.Sprint(name) }\ntype Box struct{}\nfunc (b *Box) Open() { fmt.Println(Greet("a")) }\n',
    fn: 'Greet', type: 'Box', call: 'Greet', imported: 'fmt',
  },
  {
    language: 'rust',
    source: 'use crate::util::format;\npub struct Crate { n: i32 }\nimpl Crate { pub fn open(&self) -> i32 { format(self.n) } }\npub fn greet(name: &str) -> String { name.to_string() }\n',
    fn: 'greet', type: 'Crate', call: 'format', imported: 'format',
  },
  {
    language: 'c',
    source: '#include "util.h"\nint greet(const char *name) { return helper(name); }\nstruct Box { int n; };\n',
    fn: 'greet', type: 'Box', call: 'helper', imported: 'util.h',
  },
  {
    language: 'cpp',
    source: '#include <vector>\nclass Box { public: int open(int x) { return helper(x); } };\nint greet(const char *name) { return helper(name); }\n',
    fn: 'greet', type: 'Box', call: 'helper', imported: 'vector',
  },
]

for (const sample of samples) {
  test(`parse ${sample.language} symbols and calls`, async () => {
    const parsed = await parseSource(sample.language, sample.source, grammarDir)
    assert.equal(parsed.language, sample.language)
    const names = parsed.symbols.map((symbol) => symbol.name)
    assert.ok(names.includes(sample.fn), names.join(','))
    assert.ok(names.includes(sample.type), names.join(','))
    const fn = parsed.symbols.find((symbol) => symbol.name === sample.fn)
    assert.ok(fn)
    assert.ok(fn.startLine >= 1)
    assert.ok(fn.endLine >= fn.startLine)
    assert.ok(parsed.edges.some((edge) => edge.kind === 'calls' && edge.dstName === sample.call), parsed.edges.filter((edge) => edge.kind === 'calls').map((edge) => edge.dstName).join(','))
    if (sample.imported) {
      assert.ok(parsed.symbols.some((symbol) => symbol.kind === 'import' && symbol.name === sample.imported) || parsed.edges.some((edge) => edge.kind === 'imports' && (edge.dstName === sample.imported || edge.dstModule?.includes(sample.imported))))
    }
    const method = parsed.symbols.find((symbol) => symbol.kind === 'method')
    if (sample.language === 'python' || sample.language === 'java' || sample.language === 'go' || sample.language === 'rust') {
      assert.ok(method, parsed.symbols.map((symbol) => `${symbol.kind}:${symbol.qualified}`).join(','))
      assert.ok(method.qualified.includes('.'))
    }
  })
}

test('plain text falls back to sections', async () => {
  const parsed = await parseSource('plaintext', '# Harbor\n\nThe ferry leaves at dawn.\n\n# Tickets\n\nThey cost 120.\n', grammarDir)
  assert.equal(parsed.language, 'plaintext')
  assert.deepEqual(parsed.symbols.map((symbol) => symbol.name), ['Harbor', 'Tickets'])
  assert.equal(parsed.symbols[0]?.startLine, 1)
  assert.equal(parsed.edges.length, 0)
})

test('scan respects gitignore, binaries, secrets, and size caps', () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-scan-'))
  try {
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(root, 'skip'))
    mkdirSync(join(root, 'pkg'))
    writeFileSync(join(root, '.gitignore'), 'secret.py\nskip/\n')
    writeFileSync(join(root, 'pkg', '.gitignore'), '*.tmp\n')
    writeFileSync(join(root, 'src', 'main.py'), 'def hi():\n    return 1\n')
    writeFileSync(join(root, 'secret.py'), 'def hidden():\n    return 1\n')
    writeFileSync(join(root, 'skip', 'nope.py'), 'x = 1\n')
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')
    writeFileSync(join(root, 'src', 'logo.png'), 'not really a png')
    writeFileSync(join(root, '.env'), 'TOKEN=1\n')
    writeFileSync(join(root, 'pkg', 'note.tmp'), 'temp\n')
    writeFileSync(join(root, 'pkg', 'keep.py'), 'def keep():\n    return 1\n')
    writeFileSync(join(root, 'README.md'), '# Notes\n\nHello\n')
    writeFileSync(join(root, 'huge.py'), 'x = 1\n' + ('a'.repeat(600_000)))
    const scan = scanProject(root, { maxFileBytes: 512 * 1024, maxFiles: 20, maxTotalBytes: 2_000_000, maxLineChars: 8000 })
    const rels = scan.files.map((file) => file.rel).sort()
    assert.deepEqual(rels, ['README.md', 'pkg/keep.py', 'src/main.py'])
    assert.ok(scan.ignored >= 3)
    assert.ok(scan.binaries >= 1)
    assert.ok(scan.tooBig >= 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
