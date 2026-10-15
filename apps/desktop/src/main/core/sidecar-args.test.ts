import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LlamaServer } from './sidecar-manager.js'

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
