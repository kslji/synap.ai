import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import { chunkByHeading } from './code-pack-chunk.js'
import { detectProjectStack } from './code-pack-detect.js'
import { ensureCitations, packReferenceBlock, unknownApiRefusal } from './code-pack-prompt.js'
import { searchCodePack, type PackHit } from './code-pack-search.js'
import { createCodePackDatabase, insertCodePackChunks, openCodePackDatabase } from './code-pack-store.js'
import { installBundledCodePack } from './code-pack-install.js'
import { prepareCodePackTurn } from './code-pack-turn.js'
import { writeVectorCache } from './code-pack-index.js'
import { loadCodePack, type CodePackManifest } from './code-pack.js'
import { gatePackDecrypt } from './licence.js'
import { CODE_PACK_QUESTIONS, codePackFactQuestions } from './code-pack-eval-set.js'

function publicHex(key: KeyObject): string {
  const jwk = key.export({ format: 'jwk' }) as { x: string }
  return Buffer.from(jwk.x, 'base64url').toString('hex')
}

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('chunks split on headings and long sections', () => {
  const chunks = chunkByHeading('# Top\n\nIntro paragraph that is long enough to keep.\n\n## Next\n\n' + 'word '.repeat(800))
  assert.equal(chunks[0]?.heading, 'Top')
  assert.ok(chunks.length > 2)
  assert.ok(chunks.every((chunk) => chunk.heading === 'Top' || chunk.heading === 'Next'))
  assert.equal(chunkByHeading('no heading here, but the paragraph is long enough to keep as one chunk.').length, 1)
})

test('search filters by language and fuses a vector hit', () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-pack-search-'))
  try {
    const db = createCodePackDatabase(join(root, 'keyword.sqlite'))
    insertCodePackChunks(db, [
      { language: 'python', library: 'asyncio', version: '3.14.0', sourceUrl: 'https://docs.python.org/3.14/library/asyncio.html', licence: 'PSF-2.0 OR 0BSD', title: 'Python 3.14 docs', heading: 'asyncio', citation: 'Python 3.14 docs, asyncio', text: 'special case for asyncio.run when a loop is already running' },
      { language: 'rust', library: 'Vec', version: '1.90.0', sourceUrl: 'https://doc.rust-lang.org/std/vec/', licence: 'MIT OR Apache-2.0', title: 'Rust 1.90 std', heading: 'note', citation: 'Rust 1.90 std, Vec', text: 'special special special noise about vectors' },
    ])
    db.close()
    const opened = openCodePackDatabase(join(root, 'keyword.sqlite'))
    const python = searchCodePack(opened, 'special', { filter: { languages: ['python'] }, k: 5 })
    assert.deepEqual(python.map((hit) => hit.language), ['python'])
    const keyword = searchCodePack(opened, 'special', { k: 5 })
    assert.equal(keyword[0]?.language, 'rust')
    const pythonId = keyword.find((hit) => hit.language === 'python')?.id
    assert.ok(pythonId)
    const vec = new Float32Array(256)
    vec[0] = 1
    const cache = writeVectorCache(join(root, 'vec.sqlite'), '2026.10.17', [{ id: pythonId, vector: vec }])
    const hybrid = searchCodePack(opened, 'special', { qvec: vec, vectorDb: cache, k: 5 })
    assert.equal(hybrid[0]?.language, 'python')
    cache.close()
    opened.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('citations name the source and an unknown API is refused', () => {
  const hit = {
    id: 1, language: 'python', library: 'asyncio', version: '3.14.0', sourceUrl: 'https://docs.python.org/3.14/library/asyncio.html',
    licence: 'PSF-2.0 OR 0BSD', title: 'Python 3.14 docs', heading: 'asyncio', citation: 'Python 3.14 docs, asyncio',
    text: 'asyncio.run runs a coroutine.', bm25Rank: 0, vecRank: null, cosine: 0, rrf: 0.01, score: 0.01,
  } satisfies PackHit
  const block = packReferenceBlock([hit], 2000)
  assert.match(block.text, /From: Python 3.14 docs, asyncio/)
  assert.equal(block.used.length, 1)
  const cited = ensureCitations('Call asyncio.run.', block.used)
  assert.match(cited, /From: Python 3.14 docs, asyncio/)
  assert.equal(unknownApiRefusal('What does python.never.widgetize() return?', [hit]), 'python.never.widgetize is not in the Code pack. I will not guess its arguments or return value.')
  assert.equal(unknownApiRefusal('What does asyncio.run() do?', [hit]), null)
})

test('project languages and libraries come from the files', () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-pack-detect-'))
  try {
    writeFileSync(join(root, 'app.py'), 'print(1)\n')
    writeFileSync(join(root, 'index.js'), 'console.log(1)\n')
    writeFileSync(join(root, 'requirements.txt'), 'fastapi\npytest\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '1', next: '2' } }))
    const stack = detectProjectStack(root)
    assert.ok(stack.languages.includes('python'))
    assert.ok(stack.languages.includes('javascript'))
    assert.ok(stack.libraries.includes('fastapi'))
    assert.ok(stack.libraries.includes('pytest'))
    assert.ok(stack.libraries.includes('react'))
    assert.ok(stack.libraries.includes('nextjs'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a locked licence does not read pack chunks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-pack-gate-'))
  const { privateKey } = generateKeyPairSync('ed25519')
  const keys = { 'k-test': publicHex(privateKey) }
  try {
    const dir = await writeSignedPack(root, privateKey, 'k-test')
    const locked = gatePackDecrypt(true, { allowed: false, contentKey: null, encrypted: false })
    assert.equal(locked.status, 'locked')
    const turn = await prepareCodePackTurn({
      userData: root,
      bundledDir: dir,
      keys,
      allowed: false,
      projectRoot: root,
      question: 'How do I run a Python coroutine?',
    })
    assert.equal(turn.reference, '')
    assert.equal(turn.hits.length, 0)
    const open = await prepareCodePackTurn({
      userData: join(root, 'open-user'),
      bundledDir: dir,
      keys,
      allowed: true,
      projectRoot: root,
      question: 'How does asyncio.run work?',
    })
    assert.match(open.reference, /asyncio\.run/)
    assert.match(open.citations[0]?.pack ?? '', /asyncio/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('install copies a signed pack and refuses a bad signature', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-pack-install-'))
  const { privateKey } = generateKeyPairSync('ed25519')
  const keys = { 'k-test': publicHex(privateKey) }
  try {
    const bundled = await writeSignedPack(root, privateKey, 'k-test')
    const dest = join(root, 'user', 'code-pack')
    const ready = await installBundledCodePack(bundled, dest, keys)
    assert.equal(ready.status, 'ready')
    writeFileSync(join(bundled, 'manifest.sig'), Buffer.alloc(64))
    const again = await installBundledCodePack(bundled, join(root, 'user2', 'code-pack'), keys)
    assert.equal(again.status, 'invalid')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the shipped pack verifies and retrieves every fact', async () => {
  const desktop = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const packDir = join(desktop, 'resources', 'code-pack')
  const keys = JSON.parse(readFileSync(join(desktop, 'resources', 'pack-keys.json'), 'utf8')) as { keys: Record<string, string> }
  const loaded = await loadCodePack(packDir, keys.keys)
  assert.equal(loaded.status, 'ready')
  if (loaded.status !== 'ready') return
  assert.equal(loaded.manifest.signing_key_id, 'code-pack-dev')
  assert.ok((loaded.manifest.chunk_count ?? 0) > 100)
  assert.ok(loaded.manifest.sources.length >= 20)
  const db = openCodePackDatabase(join(packDir, 'keyword.sqlite'))
  try {
    const misses: string[] = []
    for (const question of codePackFactQuestions()) {
      const hits = searchCodePack(db, question.question, {
        filter: { languages: [question.language], libraries: question.libraries ?? [] },
        k: 8,
      })
      const blob = hits.map((hit) => `${hit.heading}\n${hit.text}`).join('\n')
      const missing = question.expect.filter((fact) => !blob.includes(fact))
      if (missing.length) misses.push(`${question.id}: ${missing.join(' | ')}`)
    }
    assert.deepEqual(misses, [])
    for (const question of CODE_PACK_QUESTIONS.filter((item) => item.fakeApi)) {
      const hits = searchCodePack(db, question.question, { filter: { languages: [question.language] }, k: 8 })
      assert.ok(unknownApiRefusal(question.question, hits), question.id)
    }
  } finally {
    db.close()
  }
})

test('the eval set has at least 50 fact questions', () => {
  const facts = codePackFactQuestions()
  assert.ok(facts.length >= 50)
  const ids = new Set(facts.map((question) => question.id))
  assert.equal(ids.size, facts.length)
  for (const question of facts) assert.ok(question.expect.length > 0)
})

async function writeSignedPack(root: string, privateKey: KeyObject, keyId: string): Promise<string> {
  const dir = join(root, 'bundled')
  mkdirSync(dir)
  const db = createCodePackDatabase(join(dir, 'keyword.sqlite'))
  insertCodePackChunks(db, [{
    language: 'python', library: 'asyncio', version: '3.14.0',
    sourceUrl: 'https://docs.python.org/3.14/library/asyncio.html', licence: 'PSF-2.0 OR 0BSD',
    title: 'Python 3.14 docs', heading: 'asyncio', citation: 'Python 3.14 docs, asyncio',
    text: 'asyncio.run runs a coroutine from synchronous code and raises RuntimeError if a loop is already running.',
  }])
  db.close()
  const sqlite = readFileSync(join(dir, 'keyword.sqlite'))
  const manifest: CodePackManifest = {
    format: 'surf-code-pack/1',
    pack_id: 'code',
    version: '2026.10.17',
    created_at: '2026-10-17T00:00:00Z',
    min_app_version: '0.1.0',
    signing_key_id: keyId,
    files: [{ name: 'keyword.sqlite', size: sqlite.length, sha256: (await import('node:crypto')).createHash('sha256').update(sqlite).digest('hex') }],
    sources: [],
  }
  const body = Buffer.from(JSON.stringify(manifest))
  writeFileSync(join(dir, 'manifest.json'), body)
  writeFileSync(join(dir, 'manifest.sig'), sign(null, body, privateKey))
  const loaded = await loadCodePack(dir, { [keyId]: publicHex(privateKey) })
  assert.equal(loaded.status, 'ready')
  return dir
}
