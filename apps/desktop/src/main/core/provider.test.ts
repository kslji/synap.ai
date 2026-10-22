/**
 * ModelProvider seam tests (M2).
 *
 * They lock the contract between the agent loop and a transport:
 *  1. adapters keep the CompletionRequest shape intact in both directions,
 *  2. LocalLlamaProvider maps the request onto the llama-server fields it always used,
 *  3. GatewayProvider normalizes an SSE stream into the SAME ModelTurn the offline
 *     path produces from the same frames (tool-call deltas assembled identically),
 *  4. the gateway's 401 / 402 / 429 user-facing copies survive.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { completeToProvider, providerToComplete, type ChatMessage, type CompletionRequest, type GenerateOptions, type ModelTurn } from '@surf/agent-core'
import { LlamaClient } from './llama-client.js'
import { LocalLlamaProvider, llamaCompletionExtras, llamaCompleter } from './code-agent/llama.js'
import { GatewayProvider } from './gateway-provider.js'

const messages: ChatMessage[] = [
  { role: 'system', content: 'rules' },
  { role: 'user', content: 'bump n' },
]

/** Deterministic stringify: keys sorted so JSON key order never leaks into an assertion. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
  )
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** One streamed turn: text, then a native tool call split across delta frames, usage, billing, [DONE]. */
function sseTurn(): string {
  return [
    frame({ choices: [{ delta: { content: 'Bump' } }] }),
    ': keepalive\n\n',
    frame({ choices: [{ delta: { content: 'ing n now' } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'propose_edit', arguments: '{"path":"sr' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'c/a.ts","old":"export const n = 1","new":"export const n = 2"}' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_2', function: { name: 'finish', arguments: '{"summary":"done"}' } }] } }] }),
    frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 11, completion_tokens: 7 } }),
    frame({ billing: { charged: 0.001 } }),
    'data: [DONE]\n\n',
  ].join('')
}

function sseResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

test('adapters keep the CompletionRequest shape intact in both directions', async () => {
  const request: CompletionRequest = {
    messages,
    tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }],
    responseFormat: { type: 'json_schema', json_schema: { name: 'call', strict: true, schema: {} } },
    grammar: 'root ::= "finish"',
    thinking: false,
    maxTokens: 512,
    stepKind: 'edit',
    cachePrompt: true,
  }

  const seen: CompletionRequest[] = []
  const viaProvider = providerToComplete({
    async generate(nextMessages, options) {
      seen.push({ messages: nextMessages, ...options })
      return { content: 'ok' }
    },
  })
  const turn = await viaProvider(request)
  assert.equal(turn.content, 'ok')
  assert.equal(canonical(seen[0]), canonical(request), 'loop request must reach the provider unchanged')

  const seenRequests: CompletionRequest[] = []
  const viaComplete = completeToProvider(async (req) => {
    seenRequests.push(req)
    return { content: 'ok2' }
  })
  const { messages: head, ...options } = request
  await viaComplete.generate(head as ChatMessage[], options as GenerateOptions)
  assert.equal(canonical(seenRequests[0]), canonical(request), 'provider call must rebuild the same request')
})

test('LocalLlamaProvider sends the same llama-server fields the offline path always used', async () => {
  const bodies: Record<string, unknown>[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  try {
    const client = new LlamaClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k' })
    const provider = new LocalLlamaProvider(client)
    await provider.generate(messages, {
      maxTokens: 640,
      tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }],
      responseFormat: { type: 'json_schema', json_schema: { name: 'call', strict: true, schema: {} } },
      grammar: 'root ::= "finish"',
      thinking: true,
      cachePrompt: true,
    })
    const body = bodies[0]
    assert.equal(body.max_tokens, 640)
    assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'read_file', parameters: {} } }])
    assert.equal(body.grammar, 'root ::= "finish"')
    assert.equal(body.cache_prompt, true)
    assert.equal((body.response_format as { type: string }).type, 'json_schema')
    assert.equal((body.chat_template_kwargs as Record<string, unknown>).enable_thinking, true)

    // The one-line adapter keeps the old call-site semantics.
    assert.equal(typeof llamaCompleter(client), 'function')
    assert.deepEqual(llamaCompletionExtras({}), {})
    assert.deepEqual(llamaCompletionExtras({ responseFormat: undefined, grammar: 'g', thinking: false, cachePrompt: true }), {
      grammar: 'g',
      enableThinking: false,
      cachePrompt: true,
    })
  } finally {
    globalThis.fetch = original
  }
})

test('GatewayProvider normalizes streamed content and tool-call deltas into a ModelTurn', async () => {
  const deltas: string[] = []
  let url = ''
  let sent: Record<string, unknown> = {}
  const provider = new GatewayProvider({
    baseUrl: 'https://gateway.test/',
    token: 'jwt',
    model: 'openai/gpt-4o-mini',
    fetchImpl: (async (input: unknown, init?: RequestInit) => {
      url = String(input)
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return sseResponse(sseTurn())
    }) as typeof fetch,
  })

  const turn = await provider.generate(messages, {
    maxTokens: 512,
    tools: [{ type: 'function', function: { name: 'propose_edit', parameters: {} } }],
    onDelta: (piece) => deltas.push(piece),
  })

  assert.equal(url, 'https://gateway.test/api/v1/agent/completions')
  assert.equal(sent.model, 'openai/gpt-4o-mini')
  assert.equal(sent.stream, true)
  assert.equal(sent.max_tokens, 512)
  assert.deepEqual(sent.messages, messages)
  assert.ok(Array.isArray(sent.tools))
  assert.equal(sent.response_format, undefined, 'no constraint ladder fallback requested')
  assert.equal(sent.grammar, undefined)
  assert.equal(deltas.join(''), 'Bumping n now')
  assert.equal(turn.content, 'Bumping n now')
  assert.deepEqual(turn.toolCalls, [
    { id: 'call_1', name: 'propose_edit', arguments: '{"path":"src/a.ts","old":"export const n = 1","new":"export const n = 2"}' },
    { id: 'call_2', name: 'finish', arguments: '{"summary":"done"}' },
  ])
  assert.deepEqual(turn.usage, { promptTokens: 11, completionTokens: 7 })
})

test('GatewayProvider produces the identical ModelTurn to the offline path for the same frames', async () => {
  const body = sseTurn()
  const options: GenerateOptions = {
    maxTokens: 512,
    tools: [{ type: 'function', function: { name: 'propose_edit', parameters: {} } }],
    onDelta: () => {},
  }

  const original = globalThis.fetch
  globalThis.fetch = (async () => sseResponse(body)) as typeof fetch
  let offline: ModelTurn
  try {
    offline = await new LocalLlamaProvider(new LlamaClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k' })).generate(messages, options)
  } finally {
    globalThis.fetch = original
  }
  const online = await new GatewayProvider({
    baseUrl: 'https://gateway.test',
    token: 'jwt',
    model: 'm',
    fetchImpl: (async () => sseResponse(body)) as typeof fetch,
  }).generate(messages, options)

  assert.equal(canonical(online), canonical(offline), 'online and offline must hand the loop the same turn shape')
})

test('GatewayProvider preserves the gateway error copies', async () => {
  const cases: Array<{ status: number; body: string; copy: string }> = [
    { status: 402, body: JSON.stringify({ detail: 'Insufficient balance of 3 credits.' }), copy: 'Insufficient balance of 3 credits.' },
    { status: 402, body: '{}', copy: 'Insufficient Surf balance. Top up to keep using cloud models.' },
    { status: 401, body: '{}', copy: 'Please sign in again to use cloud models.' },
    { status: 429, body: '{}', copy: 'The cloud model is busy. Please try again in a moment.' },
    { status: 500, body: JSON.stringify({ error: { message: 'provider key revoked' } }), copy: 'provider key revoked' },
  ]
  for (const item of cases) {
    const provider = new GatewayProvider({
      baseUrl: 'https://gateway.test',
      token: 'jwt',
      model: 'm',
      fetchImpl: (async () => new Response(item.body, { status: item.status, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
    })
    await assert.rejects(provider.generate(messages, { maxTokens: 64 }), (error: Error) => {
      assert.equal(error.message, item.copy)
      return true
    }, `status ${item.status}`)
  }
})

test('GatewayProvider raises a mid-stream error frame', async () => {
  const provider = new GatewayProvider({
    baseUrl: 'https://gateway.test',
    token: 'jwt',
    model: 'm',
    fetchImpl: (async () => sseResponse(`${frame({ choices: [{ delta: { content: 'hi' } }] })}${frame({ error: { message: 'The cloud model is unavailable right now. Please try again.' } })}`)) as typeof fetch,
  })
  await assert.rejects(provider.generate(messages, { maxTokens: 64 }), /unavailable right now/)
})
