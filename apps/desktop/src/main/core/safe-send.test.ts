import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { test } from 'node:test'
import { downloadVerified } from './model-download.js'
import { attachPipeGuard, isClosedPipe } from './main-log.js'
import { safeSend, type SendTarget } from './safe-send.js'

function closedWindow(): SendTarget {
  return {
    isDestroyed: () => true,
    webContents: {
      isDestroyed: () => true,
      isCrashed: () => false,
      send() { throw Object.assign(new Error('write EIO'), { code: 'EIO' }) },
    },
  }
}

test('safeSend does nothing when webContents is destroyed', () => {
  const calls: string[] = []
  const win: SendTarget = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => true,
      isCrashed: () => false,
      send(channel: string) { calls.push(channel) },
    },
  }
  assert.equal(safeSend(win, 'chat:event', { type: 'token' }), false)
  assert.deepEqual(calls, [])
  assert.equal(safeSend(null, 'chat:event', {}), false)
  assert.equal(safeSend(closedWindow(), 'models:event', { state: 'progress' }), false)
})

test('a download stream emitting after the window closes does not throw', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-send-'))
  const dest = join(dir, 'model.bin')
  const first = new Uint8Array([1, 2, 3, 4])
  const second = new Uint8Array([5, 6, 7, 8])
  const bytes = Buffer.concat([Buffer.from(first), Buffer.from(second)])
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  let calls = 0
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first)
      controller.enqueue(second)
      controller.close()
    },
  })
  try {
    await downloadVerified(
      { url: 'http://127.0.0.1/model.bin', dest, size: bytes.length, sha256 },
      () => {
        calls += 1
        const sent = safeSend(closedWindow(), 'models:event', { state: 'progress', done: calls })
        if (!sent) throw Object.assign(new Error('write EIO'), { code: 'EIO' })
      },
      undefined,
      async () => new Response(stream),
    )
    assert.equal(readFileSync(dest).equals(bytes), true)
    assert.ok(calls >= 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stdout EIO is swallowed', async () => {
  const sink = new Writable({
    write(_chunk, _enc, cb) {
      cb(Object.assign(new Error('write EIO'), { code: 'EIO' }))
    },
  })
  attachPipeGuard(sink)
  const uncaught = new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      process.removeListener('uncaughtException', onUncaught)
      resolve(null)
    }, 50)
    function onUncaught(err: unknown) {
      clearTimeout(timer)
      resolve(err)
    }
    process.on('uncaughtException', onUncaught)
  })
  sink.write('progress')
  const err = await uncaught
  assert.equal(err, null)
  assert.equal(isClosedPipe(Object.assign(new Error('write EIO'), { code: 'EIO' })), true)
  assert.equal(isClosedPipe(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })), true)
})
