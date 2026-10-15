import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { hashEmbedder } from './code/embed.js'
import { CodeIndex, dbFileBytes } from './code/project.js'
import { watchProject } from './code/watch.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/tree-sitter')
const key = 'ef'.repeat(32)

test('incremental update replaces symbols and a delete drops the file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-incr-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.py'), 'def alpha():\n    return 1\n')
  writeFileSync(join(root, 'src', 'b.py'), 'from src.a import alpha\n\ndef run():\n    return alpha()\n')
  const index = new CodeIndex({
    root,
    dbPath: join(root, '.index.sqlite'),
    keyHex: key,
    grammarDir,
    embedder: hashEmbedder(),
  })
  try {
    const first = await index.run()
    assert.equal(first.state, 'ready')
    assert.equal(first.files, 2)
    assert.ok((await index.definition('alpha')).length === 1)
    assert.ok((await index.references('alpha')).some((ref) => ref.kind === 'calls'))

    const again = await index.run()
    assert.equal(again.symbols, first.symbols)

    writeFileSync(join(root, 'src', 'a.py'), 'def beta():\n    return 2\n')
    await index.update(['src/a.py'])
    assert.equal((await index.definition('alpha')).length, 0)
    assert.equal((await index.definition('beta')).length, 1)
    assert.ok((await index.references('alpha')).some((ref) => ref.kind === 'calls' && ref.path === 'src/b.py'))

    writeFileSync(join(root, 'src', 'b.py'), 'from src.a import beta\n\ndef run():\n    return beta()\n')
    await index.update(['src/b.py'])
    assert.equal((await index.references('alpha')).filter((ref) => ref.kind === 'calls').length, 0)
    assert.ok((await index.references('beta')).some((ref) => ref.kind === 'calls' && ref.srcQualified === 'run'))

    unlinkSync(join(root, 'src', 'b.py'))
    await index.update(['src/b.py'])
    assert.equal((await index.definition('run')).length, 0)
    const after = index.status()
    assert.equal(after.files, 1)
    assert.ok(dbFileBytes(index.dbPath) > 0)
  } finally {
    index.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('plaintext index works without an embedder', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-plain-'))
  writeFileSync(join(root, 'notes.md'), '# Harbor\n\nThe ferry leaves at dawn.\n')
  const index = new CodeIndex({ root, dbPath: join(root, 'index.sqlite'), keyHex: null, grammarDir })
  try {
    const status = await index.run()
    assert.equal(status.encrypted, false)
    assert.equal(status.embeddings, 'off')
    const hits = await index.search('ferry leaves')
    assert.equal(hits[0]?.name, 'Harbor')
  } finally {
    index.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('watcher reports a changed file once', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-watch-'))
  try {
    const seen = await new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('watcher timed out')), 4000)
      const watcher = watchProject(root, (rels) => {
        clearTimeout(timer)
        watcher.close()
        resolve(rels)
      }, 30)
      setTimeout(() => writeFileSync(join(root, 'new.py'), 'def fresh():\n    return 1\n'), 50)
    })
    assert.ok(seen.some((rel) => rel.endsWith('new.py')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
