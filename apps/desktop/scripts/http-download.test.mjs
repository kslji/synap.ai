import assert from 'node:assert/strict'
import test from 'node:test'
import { BODY_TIMEOUT_MS, CONNECT_TIMEOUT_MS, DOWNLOAD_ATTEMPTS, downloadDispatcher, fetchDownload, httpFailure, withDownloadRetry } from './http-download.mjs'

test('download settings wait longer than undici\'s 10s connect timeout and retry a few times', () => {
  assert.ok(DOWNLOAD_ATTEMPTS >= 3 && DOWNLOAD_ATTEMPTS <= 5)
  assert.ok(CONNECT_TIMEOUT_MS >= 30_000)
  assert.ok(BODY_TIMEOUT_MS >= CONNECT_TIMEOUT_MS)
  assert.equal(downloadDispatcher.constructor.name, 'Agent')
})

test('fetchDownload sends the long-timeout dispatcher', async () => {
  let seen
  const fetchImpl = async (_url, init) => {
    seen = init
    return { ok: true, body: null }
  }
  await fetchDownload('https://example.test/file', fetchImpl)
  assert.equal(seen.dispatcher, downloadDispatcher)
  assert.equal(seen.redirect, 'follow')
  assert.equal(typeof seen.signal.aborted, 'boolean')
})

test('a connect failure is retried with backoff, then succeeds', async () => {
  const delays = []
  let calls = 0
  const value = await withDownloadRetry(async () => {
    calls += 1
    if (calls < 3) throw Object.assign(new Error('ConnectTimeoutError'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
    return 'bytes'
  }, {
    attempts: 5,
    sleep: async (ms) => { delays.push(ms) },
    warn: () => {},
  })
  assert.equal(value, 'bytes')
  assert.equal(calls, 3)
  assert.deepEqual(delays, [2000, 4000])
})

test('a client error is not retried', async () => {
  let calls = 0
  await assert.rejects(() => withDownloadRetry(async () => {
    calls += 1
    throw httpFailure('https://example.test/missing', 404)
  }, { sleep: async () => { throw new Error('should not sleep') }, warn: () => {} }), /HTTP 404/)
  assert.equal(calls, 1)
})

test('retries stop after the attempt cap', async () => {
  let calls = 0
  const delays = []
  await assert.rejects(() => withDownloadRetry(async () => {
    calls += 1
    throw new Error('fetch failed')
  }, {
    attempts: 5,
    sleep: async (ms) => { delays.push(ms) },
    warn: () => {},
  }), /fetch failed/)
  assert.equal(calls, 5)
  assert.deepEqual(delays, [2000, 4000, 8000, 16000])
})
