/**
 * Thinking policy: off for Tab, inline edit, quick chat, and each edit step; on only for planning
 * and the fix after a failure, capped at 512 reasoning tokens, then the answer is forced with
 * thinking off. These tests pin the policy table and the two-request shape on the wire.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LlamaClient } from './llama-client.js'
import { LocalLlamaProvider } from './code-agent/llama.js'
import { answerMessages, REASONING_TOKEN_CAP, reasoningRequest, thinkingFor } from './thinking.js'

const messages = [
  { role: 'system' as const, content: 'rules' },
  { role: 'user' as const, content: 'rename greet' },
]

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** One SSE stream: optional reasoning deltas, then content, then usage and [DONE]. */
function stream(reasoning: string[], content: string, usage?: { prompt_tokens: number; completion_tokens: number }): Response {
  const body = [
    ...reasoning.map((piece) => frame({ choices: [{ delta: { reasoning_content: piece } }] })),
    ...(content ? [frame({ choices: [{ delta: { content } }] })] : []),
    frame({ choices: [{ delta: {}, finish_reason: 'stop' }], ...(usage ? { usage } : {}) }),
    'data: [DONE]\n\n',
  ].join('')
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** A non-streaming reply, the shape llama-server uses when nobody is listening for deltas. */
function reply(message: Record<string, unknown>, finish = 'stop', usage?: { prompt_tokens: number; completion_tokens: number }): Response {
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', ...message }, finish_reason: finish }], ...(usage ? { usage } : {}) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('thinking is off for what a person waits on, and on only for plan and fix', () => {
  assert.equal(thinkingFor('tab'), false)
  assert.equal(thinkingFor('inline-edit'), false)
  assert.equal(thinkingFor('quick-chat'), false)
  assert.equal(thinkingFor('edit-step'), false)
  assert.equal(thinkingFor('plan'), true)
  assert.equal(thinkingFor('fix'), true)
})

test('the reasoning cap is 512 tokens and the think request asks for reasoning only', () => {
  assert.equal(REASONING_TOKEN_CAP, 512)
  assert.deepEqual(reasoningRequest(), { maxTokens: 512, enableThinking: true })
})

test('the forced answer gets the reasoning back as one user turn', () => {
  const next = answerMessages(messages, '  Step one is src/a.ts.\n')
  assert.equal(next.length, 3)
  assert.equal(next[2]?.role, 'user')
  assert.match(String(next[2]?.content), /src\/a\.ts/)
  assert.match(String(next[2]?.content), /Stop thinking/)
  const empty = answerMessages(messages, '   ')
  assert.deepEqual(empty, messages)
  assert.notEqual(empty, messages, 'returns a copy, never the caller array')
})

test('a thinking step is two llama-server calls: capped reasoning, then the answer', async () => {
  const bodies: Record<string, unknown>[] = []
  const original = globalThis.fetch
  const seen: string[] = []
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    bodies.push(body)
    if (bodies.length === 1) {
      seen.push('think')
      return reply({ content: '', reasoning_content: 'Check src/a.ts. Then run tests.' }, 'length', { prompt_tokens: 12, completion_tokens: 9 })
    }
    seen.push('answer')
    return reply({ content: '{"steps":[]}' }, 'stop', { prompt_tokens: 20, completion_tokens: 4 })
  }) as typeof fetch
  try {
    const provider = new LocalLlamaProvider(new LlamaClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k' }))
    const turn = await provider.generate(messages, {
      maxTokens: 640,
      thinking: true,
      stepKind: 'plan',
      responseFormat: { type: 'json_schema', json_schema: { name: 'plan', strict: true, schema: {} } },
      grammar: 'root ::= "x"',
      tools: [{ type: 'function', function: { name: 'read_file', parameters: {} } }],
    })
    assert.deepEqual(seen, ['think', 'answer'])

    const think = bodies[0] ?? {}
    assert.equal(think.max_tokens, REASONING_TOKEN_CAP)
    assert.equal((think.chat_template_kwargs as Record<string, unknown>).enable_thinking, true)
    assert.equal(think.tools, undefined, 'the think request never calls tools')
    assert.equal(think.response_format, undefined, 'the think request is not forced into the answer shape')
    assert.equal(think.grammar, undefined)

    const answer = bodies[1] ?? {}
    assert.equal(answer.max_tokens, 640)
    assert.equal((answer.chat_template_kwargs as Record<string, unknown>).enable_thinking, false)
    assert.equal((answer.response_format as { type: string }).type, 'json_schema')
    assert.equal(answer.grammar, 'root ::= "x"')
    const sent = answer.messages as { role: string; content: string }[]
    assert.equal(sent.length, 3)
    assert.match(sent[2]?.content ?? '', /Check src\/a\.ts\./)
    assert.match(sent[2]?.content ?? '', /Stop thinking/)

    assert.equal(turn.content, '{"steps":[]}')
    assert.deepEqual(turn.usage, { promptTokens: 32, completionTokens: 13 }, 'reasoning tokens are counted too')
  } finally {
    globalThis.fetch = original
  }
})

test('thinking is off by default and no path inherits it', async () => {
  const bodies: Record<string, unknown>[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return reply({ content: 'ok' })
  }) as typeof fetch
  try {
    const provider = new LocalLlamaProvider(new LlamaClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k' }))
    await provider.generate(messages, { maxTokens: 64, stepKind: 'edit' })
    assert.equal(bodies.length, 1, 'no thinking means one request')
    assert.equal((bodies[0]?.chat_template_kwargs as Record<string, unknown>).enable_thinking, false)
  } finally {
    globalThis.fetch = original
  }
})

test('reasoning deltas stream to the caller and never leak into the answer', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => stream(['Thinking. ', 'Still thinking.'], 'Done.')) as typeof fetch
  try {
    const client = new LlamaClient({ baseUrl: 'http://127.0.0.1:1', apiKey: 'k' })
    const seen: string[] = []
    const res = await client.chatCollect(messages, undefined, undefined, 64, { enableThinking: true }, () => undefined, (piece) => seen.push(piece))
    assert.deepEqual(seen, ['Thinking. ', 'Still thinking.'])
    assert.equal(res.reasoning, 'Thinking. Still thinking.')
    assert.equal(res.choices[0]?.message.content, 'Done.')
  } finally {
    globalThis.fetch = original
  }
})
