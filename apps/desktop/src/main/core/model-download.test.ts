import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { requiredFreeBytes } from '../../shared/setup-choice.js'
import { copyVerified, downloadVerified, DownloadError } from './model-download.js'

test('a model download resumes from the part file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-'))
  const dest = join(root, 'model.gguf')
  const full = Buffer.from('abcdefghij')
  writeFileSync(`${dest}.part`, full.subarray(0, 4))
  const sha256 = createHash('sha256').update(full).digest('hex')
  try {
    await downloadVerified({ url: 'http://127.0.0.1/model.gguf', dest, size: full.length, sha256 }, undefined, undefined, async (_url, init) => {
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=4-')
      return new Response(full.subarray(4), { status: 206 })
    })
    assert.equal(readFileSync(dest).equals(full), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a dropped connection keeps the part and the next try resumes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-net-'))
  const dest = join(root, 'model.gguf')
  const full = Buffer.from('abcdefghij')
  const sha256 = createHash('sha256').update(full).digest('hex')
  writeFileSync(`${dest}.part`, full.subarray(0, 3))
  let calls = 0
  try {
    await assert.rejects(
      () => downloadVerified({ url: 'http://127.0.0.1/model.gguf', dest, size: full.length, sha256 }, undefined, undefined, async () => {
        calls += 1
        throw new TypeError('fetch failed')
      }),
      (error: unknown) => error instanceof DownloadError && error.code === 'network',
    )
    assert.equal(existsSync(dest), false)
    assert.equal(readFileSync(`${dest}.part`).equals(full.subarray(0, 3)), true)
    await downloadVerified({ url: 'http://127.0.0.1/model.gguf', dest, size: full.length, sha256 }, undefined, undefined, async (_url, init) => {
      calls += 1
      assert.equal(new Headers(init?.headers).get('range'), 'bytes=3-')
      return new Response(full.subarray(3), { status: 206 })
    })
    assert.equal(readFileSync(dest).equals(full), true)
    assert.equal(calls, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pause keeps the part file and resume finishes it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-pause-'))
  const dest = join(root, 'model.gguf')
  const full = Buffer.from('abcdefghij')
  const sha256 = createHash('sha256').update(full).digest('hex')
  const ac = new AbortController()
  try {
    await assert.rejects(
      () => downloadVerified({ url: 'http://127.0.0.1/model.gguf', dest, size: full.length, sha256 }, (done) => {
        if (done >= 4) setTimeout(() => ac.abort(), 15)
      }, ac.signal, async () => {
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(full.subarray(0, 4))
            await new Promise((resolve) => setTimeout(resolve, 40))
            if (ac.signal.aborted) {
              controller.close()
              return
            }
            controller.enqueue(full.subarray(4))
            controller.close()
          },
        })
        return new Response(stream)
      }),
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    )
    assert.equal(existsSync(`${dest}.part`), true)
    assert.ok(readFileSync(`${dest}.part`).length >= 4)
    assert.ok(readFileSync(`${dest}.part`).length < full.length)
    await downloadVerified({ url: 'http://127.0.0.1/model.gguf', dest, size: full.length, sha256 }, undefined, undefined, async (_url, init) => {
      const start = Number(new Headers(init?.headers).get('range')?.slice('bytes='.length).replace('-', '') ?? '0')
      return new Response(full.subarray(start), { status: start ? 206 : 200 })
    })
    assert.equal(readFileSync(dest).equals(full), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a bad checksum deletes the part file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-bad-'))
  const dest = join(root, 'model.gguf')
  const body = Buffer.from('not the model')
  try {
    await assert.rejects(
      () => downloadVerified(
        { url: 'http://127.0.0.1/model.gguf', dest, size: body.length, sha256: '0'.repeat(64) },
        undefined,
        undefined,
        async () => new Response(body),
      ),
      (error: unknown) => error instanceof DownloadError && error.code === 'checksum',
    )
    assert.equal(existsSync(dest), false)
    assert.equal(existsSync(`${dest}.part`), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('disk full reports required and free bytes and does not start the file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-disk-'))
  const dest = join(root, 'model.gguf')
  const body = Buffer.from('abcdefghij')
  const sha256 = createHash('sha256').update(body).digest('hex')
  try {
    await assert.rejects(
      () => downloadVerified(
        { url: 'http://127.0.0.1/model.gguf', dest, size: body.length, sha256 },
        undefined,
        undefined,
        async () => { throw new Error('should not fetch') },
        { freeBytes: async () => 1 },
      ),
      (error: unknown) => {
        assert.ok(error instanceof DownloadError)
        assert.equal(error.code, 'disk')
        assert.equal(error.requiredBytes, requiredFreeBytes(body.length))
        assert.equal(error.freeBytes, 1)
        return true
      },
    )
    assert.equal(existsSync(dest), false)
    assert.equal(existsSync(`${dest}.part`), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a bundled file is copied and checked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'surf-model-copy-'))
  const source = join(root, 'bundled.gguf')
  const dest = join(root, 'models', 'model.gguf')
  const body = Buffer.from('bundled-model')
  writeFileSync(source, body)
  const sha256 = createHash('sha256').update(body).digest('hex')
  try {
    await copyVerified(source, { dest, size: body.length, sha256 })
    assert.equal(readFileSync(dest).equals(body), true)
    assert.equal(readFileSync(source).equals(body), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
