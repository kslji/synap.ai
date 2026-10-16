import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3-multiple-ciphers'
import nacl from 'tweetnacl'
import { decryptDelta, packContentKeys, searchDelta, secretboxOpen } from './delta.js'

const KEY = Buffer.from('22'.repeat(32), 'hex')
/** Frozen PyNaCl SecretBox of the bytes "harbor-delta-ok" with KEY. */
const PYNACL = Buffer.from('3834e099bcd74af5373b98346a392cee21b67c0fe591d71be2ae509d93710f3166ec15416b90338b2258990af4df45a4b7699ebab744b3', 'hex')

test('a PyNaCl secretbox opens and a wrong key does not', () => {
  const opened = secretboxOpen(PYNACL, KEY)
  assert.equal(Buffer.from(opened ?? []).toString(), 'harbor-delta-ok')
  assert.equal(secretboxOpen(PYNACL, Buffer.alloc(32, 1)), null)
  assert.deepEqual(packContentKeys(null, 'zz'), [])
  assert.equal(packContentKeys(KEY, undefined)[0]?.equals(KEY), true)
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
    const decrypted = decryptDelta(boxed, packContentKeys(null, KEY.toString('hex')))
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
