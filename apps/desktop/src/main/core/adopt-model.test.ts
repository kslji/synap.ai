import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { adoptFromFolder, adoptRows, adoptVerified, type AdoptRow } from './adopt-model.js'

const body = Buffer.from('surf-model-bytes')
const sha = createHash('sha256').update(body).digest('hex')
const row: AdoptRow = {
  id: 'qwen3.5-4b-q4_k_m',
  role: 'chat',
  file: 'Qwen3.5-4B-Q4_K_M.gguf',
  sha256: sha,
  size_bytes: body.length,
}

test('only chat rows with a single gguf name can be adopted', () => {
  const rows = adoptRows([
    row,
    { ...row, id: 'embed', role: 'embedding', file: 'embedding.gguf' },
    { ...row, id: 'nested', file: 'nested/model.gguf' },
    { ...row, id: 'bad', sha256: 'nope' },
  ])
  assert.deepEqual(rows.map((item) => item.id), ['qwen3.5-4b-q4_k_m'])
})

test('a matching Downloads file is hashed and moved', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-adopt-'))
  const downloads = join(root, 'downloads')
  const models = join(root, 'models')
  mkdirSync(downloads)
  const source = join(downloads, row.file)
  writeFileSync(source, body)
  writeFileSync(join(downloads, 'notes.txt'), 'leave me')
  try {
    const found = await adoptFromFolder(downloads, models, adoptRows([row]))
    assert.deepEqual(found, [{ id: row.id, moved: true }])
    assert.equal(readFileSync(join(models, row.file)).equals(body), true)
    assert.throws(() => readFileSync(source))
    assert.equal(readFileSync(join(downloads, 'notes.txt'), 'utf8'), 'leave me')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a wrong hash stays in Downloads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-adopt-bad-'))
  const downloads = join(root, 'downloads')
  const models = join(root, 'models')
  mkdirSync(downloads)
  const source = join(downloads, row.file)
  const wrong = Buffer.from('not-the-model!!')
  writeFileSync(source, wrong)
  const bad: AdoptRow = { ...row, size_bytes: wrong.length }
  try {
    const found = await adoptFromFolder(downloads, models, [bad])
    assert.deepEqual(found, [])
    assert.equal(readFileSync(source).equals(wrong), true)
    assert.throws(() => readFileSync(join(models, row.file)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a deep-link path can use a different filename when the hash matches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-adopt-link-'))
  const models = join(root, 'models')
  const source = join(root, 'picked.gguf')
  writeFileSync(source, body)
  try {
    const found = await adoptVerified(source, models, [row], 'hash')
    assert.deepEqual(found, { id: row.id, moved: true })
    assert.equal(readFileSync(join(models, row.file)).equals(body), true)
    const relative = await adoptVerified('picked.gguf', models, [row], 'hash')
    assert.equal(relative, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
