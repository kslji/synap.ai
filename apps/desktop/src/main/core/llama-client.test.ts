import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { test } from 'node:test'
import { LlamaClient } from './llama-client.js'

/**
 * A server that reads the request and never answers, which is what a wedged generation looks like
 * from the client. The eval once sat 616 s on one of these before the task's own abort landed.
 */
async function wedgedServer(): Promise<{ server: Server; baseUrl: string; hits: () => number }> {
  let hits = 0
  const server = createServer({
    // Keep the socket open with no body: fetch waits until its own signal fires.
    requestTimeout: 0,
    headersTimeout: 0,
  }, (_request, _response) => {
    hits += 1
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, hits: () => hits }
}

test('a wedged request times out and is retried once, then fails', async () => {
  const { server, baseUrl, hits } = await wedgedServer()
  const client = new LlamaClient({ baseUrl, apiKey: 'k', requestTimeoutMs: 120 })
  const started = Date.now()
  try {
    await assert.rejects(client.chat([{ role: 'user', content: 'hi' }]), /timed out/i)
    const ms = Date.now() - started
    assert.equal(hits(), 2, 'one attempt and one retry')
    assert.ok(ms >= 200, `two timeouts take at least 240 ms, took ${ms}`)
    assert.ok(ms < 5_000, `the guard must not wait, took ${ms} ms`)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('a request the caller aborted is not retried', async () => {
  const { server, baseUrl, hits } = await wedgedServer()
  const client = new LlamaClient({ baseUrl, apiKey: 'k', requestTimeoutMs: 5_000 })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 50)
  try {
    await assert.rejects(client.chat([{ role: 'user', content: 'hi' }], undefined, controller.signal))
    assert.equal(hits(), 1)
  } finally {
    server.closeAllConnections()
    server.close()
  }
})

test('a thinking request gets the longer budget so a 512-token plan is not cut off', async () => {
  const { server, baseUrl, hits } = await wedgedServer()
  // 120 ms would fail a thinking turn at once if it shared the plain-answer budget.
  const client = new LlamaClient({ baseUrl, apiKey: 'k', requestTimeoutMs: 120, thinkingTimeoutMs: 5_000 })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 400)
  try {
    await assert.rejects(client.chat([{ role: 'user', content: 'plan' }], undefined, controller.signal, 512, { enableThinking: true }))
    assert.equal(hits(), 1, 'still waiting after the plain-answer budget ran out')
  } finally {
    server.closeAllConnections()
    server.close()
  }
})
