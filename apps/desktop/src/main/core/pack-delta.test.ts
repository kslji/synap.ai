import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as nodeTest } from 'node:test'
import { sqliteSkipReason } from './native-test-support.js'
import Database from 'better-sqlite3-multiple-ciphers'
import nacl from 'tweetnacl'
import { contentKeysForDelta, decryptDelta, openSealedContentKey, searchDelta, secretboxOpen } from './pack-delta.js'
import { derivePackKey } from './licence.js'

const KEY = Buffer.from('22'.repeat(32), 'hex')
/** Frozen PyNaCl SecretBox of the bytes "harbor-delta-ok" with KEY. */
const PYNACL = Buffer.from('3834e099bcd74af5373b98346a392cee21b67c0fe591d71be2ae509d93710f3166ec15416b90338b2258990af4df45a4b7699ebab744b3', 'hex')

// Skip the whole suite when the native SQLite addon does not match this Node.
const nativeSkip = sqliteSkipReason()
const test = (name: string, fn: () => unknown): void => {
  nodeTest(name, { skip: nativeSkip }, fn as unknown as () => void)
}

test('a PyNaCl secretbox opens and a wrong key does not', () => {
  const opened = secretboxOpen(PYNACL, KEY)
  assert.equal(Buffer.from(opened ?? []).toString(), 'harbor-delta-ok')
  assert.equal(secretboxOpen(PYNACL, Buffer.alloc(32, 1)), null)
  assert.deepEqual(contentKeysForDelta(null, 'zz'), [])
  assert.equal(contentKeysForDelta(null, KEY.toString('hex'))[0]?.equals(KEY), true)
  assert.equal(contentKeysForDelta(KEY, KEY.toString('hex')).length, 1)
})

test('a decrypted delta sqlite is searchable without pack.sqlite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-delta-'))
  try {
    const path = join(dir, 'delta.sqlite')
    const db = new Database(path)
    db.exec(`
      CREATE TABLE documents (id INTEGER PRIMARY KEY, title TEXT, url TEXT);
      CREATE TABLE chunks (id INTEGER PRIMARY KEY, doc_id INTEGER, text TEXT);
      CREATE TABLE embeddings (chunk_id INTEGER PRIMARY KEY, dim INTEGER, embedding BLOB);
    `)
    const match = new Float32Array(4)
    match[0] = 1
    const other = new Float32Array(4)
    other[1] = 1
    db.prepare('INSERT INTO documents(id, title, url) VALUES (1, ?, ?)').run('Harbor note', '')
    db.prepare('INSERT INTO chunks(id, doc_id, text) VALUES (1, 1, ?)').run('The harbor code is GL-2201.')
    db.prepare('INSERT INTO chunks(id, doc_id, text) VALUES (2, 1, ?)').run('Unrelated bakery hours.')
    const insert = db.prepare('INSERT INTO embeddings(chunk_id, dim, embedding) VALUES (?, ?, ?)')
    insert.run(1, 4, Buffer.from(match.buffer))
    insert.run(2, 4, Buffer.from(other.buffer))
    db.close()
    const nonce = nacl.randomBytes(24)
    const boxed = Buffer.concat([Buffer.from(nonce), Buffer.from(nacl.secretbox(readFileSync(path), nonce, KEY))])
    const decrypted = decryptDelta(boxed, contentKeysForDelta(null, KEY.toString('hex')))
    assert.ok(decrypted)
    assert.equal(decryptDelta(boxed, [Buffer.alloc(32, 7)]), null)
    const openedPath = join(dir, 'opened.sqlite')
    writeFileSync(openedPath, decrypted, { mode: 0o600 })
    const read = new Database(openedPath, { readonly: true, fileMustExist: true })
    const hits = searchDelta('Harbor · 2026.10.16 delta', read, 'harbor code', match)
    read.close()
    assert.equal(hits[0]?.text.includes('GL-2201'), true)
    assert.ok((hits[0]?.cosine ?? 0) > 0.99)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** Same string the API hashes in content_key.derive_pack_key. */
const WRAP_VECTOR = '454fcd9de400b49b00a2f9bd8b99f5b27f1bbc93991e914d121ccb62e7a1a183'

test('a build_delta.py pack opens with the unwrapped content key', () => {
  const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/builder-delta.json'), 'utf8')) as {
    licence_id: string
    device_id_hash: string
    wrap_key_hex: string
    sealed_hex: string
    delta_hex: string
    chunk_text: string
  }
  const wrap = derivePackKey({ licence_id: fixture.licence_id, device_id_hash: fixture.device_id_hash })
  assert.equal(wrap.toString('hex'), WRAP_VECTOR)
  assert.equal(wrap.toString('hex'), fixture.wrap_key_hex)
  const content = openSealedContentKey(Buffer.from(fixture.sealed_hex, 'hex'), wrap)
  assert.ok(content)
  assert.equal(content?.toString('hex'), '22'.repeat(32))
  const delta = Buffer.from(fixture.delta_hex, 'hex')
  assert.equal(decryptDelta(delta, [wrap]), null)
  const plain = decryptDelta(delta, contentKeysForDelta(content, undefined))
  assert.ok(plain)
  const dir = mkdtempSync(join(tmpdir(), 'surf-builder-delta-'))
  try {
    const path = join(dir, 'delta.sqlite')
    writeFileSync(path, plain, { mode: 0o600 })
    const read = new Database(path, { readonly: true, fileMustExist: true })
    const row = read.prepare(
      `SELECT c.text AS text, e.embedding AS embedding, e.dim AS dim
       FROM chunks c JOIN embeddings e ON e.chunk_id = c.id`,
    ).get() as { text: string; embedding: Buffer; dim: number }
    assert.equal(row.text, fixture.chunk_text)
    const query: number[] = []
    for (let i = 0; i < row.dim; i++) query.push(row.embedding.readFloatLE(i * 4))
    const hits = searchDelta('News delta · 2026.10.16 delta', read, 'pier notice', query)
    read.close()
    assert.equal(hits[0]?.text, 'Pier 4')
    assert.ok((hits[0]?.cosine ?? 0) > 0.99)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
