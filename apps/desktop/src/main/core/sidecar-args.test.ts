import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LlamaServer } from './sidecar-manager.js'

test('a missing llama-server rejects and does not raise an uncaught exception', async () => {
  const uncaught: unknown[] = []
  const onUncaught = (err: unknown) => { uncaught.push(err) }
  process.on('uncaughtException', onUncaught)
  const server = new LlamaServer({
    binPath: '/no/such/llama-server',
    modelPath: 'model.gguf',
    ctx: 128,
    startupTimeoutMs: 2_000,
  })
  try {
    await assert.rejects(() => server.start(), /not installed/)
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(uncaught.length, 0)
  } finally {
    process.off('uncaughtException', onUncaught)
    await server.stop().catch(() => undefined)
  }
})

test('a sidecar that cannot be executed rejects without an uncaught exception', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surf-sidecar-'))
  const bin = join(dir, 'llama-server')
  writeFileSync(bin, 'not a binary\n')
  chmodSync(bin, 0o755)
  const uncaught: unknown[] = []
  const onUncaught = (err: unknown) => { uncaught.push(err) }
  process.on('uncaughtException', onUncaught)
  const server = new LlamaServer({ binPath: bin, modelPath: 'model.gguf', ctx: 128, startupTimeoutMs: 3_000 })
  try {
    // The spawn error differs by OS/Node: macOS reports `spawn ENOEXEC` (Node 22)
    // or `spawn Unknown system error -8` (Node 20), rather than a wrapped message.
    await assert.rejects(() => server.start(), /failed to start|exited during startup|spawn \S+|ENOEXEC/i)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(uncaught.length, 0)
  } finally {
    process.off('uncaughtException', onUncaught)
    await server.stop().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('llama-server starts with --no-repack and -cram 0', () => {
  const server = new LlamaServer({ binPath: 'llama-server', modelPath: 'model.gguf', ctx: 8192 })
  const args = server.args()
  assert.ok(args.includes('--no-repack'))
  const cram = args.indexOf('-cram')
  assert.ok(cram >= 0)
  assert.equal(args[cram + 1], '0')
  assert.ok(args.includes('--jinja'))
  assert.equal(args.includes('--embeddings'), false)
})

test('a draft model is passed as --spec-draft-n-max; --draft-max was removed upstream', () => {
  // build 11514 rejects --draft-max outright ("the argument has been removed"), which would
  // stop the whole chat server from starting whenever speculative decoding is enabled.
  const server = new LlamaServer({
    binPath: 'llama-server',
    modelPath: 'model.gguf',
    ctx: 8192,
    draftModelPath: '/models/draft.gguf',
    draftMax: 6,
  })
  const args = server.args()
  assert.deepEqual(args.slice(args.indexOf('-md'), args.indexOf('-md') + 2), ['-md', '/models/draft.gguf'])
  assert.equal(args[args.indexOf('--spec-draft-n-max') + 1], '6')
  assert.equal(args.includes('--draft-max'), false)
  assert.equal(args.includes('--draft'), false)
})
