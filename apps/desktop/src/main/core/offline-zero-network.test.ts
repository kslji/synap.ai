/**
 * The offline guarantee, as a test.
 *
 * Offline and Online now share ONE agent loop behind one ModelProvider seam, so the
 * risk is that an offline turn accidentally reaches the network. These tests pin the
 * three properties that make that impossible:
 *  1. only an explicit online pick selects the gateway transport - and every offline
 *     shape (no mode, Offline-only, no project, a screenshot, another agent) stays local;
 *  2. running the loop through LocalLlamaProvider performs zero fetches;
 *  3. an online turn never receives this chat's earlier offline turns until the chat
 *     has consented, and the consent flag is stored on device.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { providerToComplete } from '@surf/agent-core'
import { onlineCodeAgentTurn, type CodeTurnInput } from './code-agent/agent-route.js'
import { gatedHistory, onlineContextAllowed, readOnlineConsent, withOnlineConsent, writeOnlineConsent } from './code-agent/online-consent.js'
import { LocalLlamaProvider } from './code-agent/llama.js'
import { runCodeAgent, type CompletionRequest } from './code-agent/loop.js'
import type { ProjectContext, ProjectSearch } from './code-agent/project-search.js'
import { heuristicCounter } from './token-budget.js'
import type { ChatMessage } from './llama-client.js'

const GATEWAY = 'https://gateway.synap.surf'

function tempDir(): { dir: string; dispose(): void } {
  const base = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../.golden-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'consent-'))
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

// --- 1. transport selection ---------------------------------------------------

const onlineTurn: CodeTurnInput = {
  mode: 'online',
  agentId: 'code',
  hasRoot: true,
  images: 0,
  offlineOnly: false,
  wantsProjectFiles: true,
}

test('only an explicit online code turn reaches the gateway', () => {
  assert.equal(onlineCodeAgentTurn(onlineTurn), true)
  // Every offline-shaped input stays on the local sidecar.
  const offlineShapes: Array<[string, Partial<CodeTurnInput>]> = [
    ['no mode picked', { mode: undefined }],
    ['offline picked', { mode: 'offline' }],
    ['offline-only mode on', { offlineOnly: true }],
    ['no project open', { hasRoot: false }],
    ['not the code agent', { agentId: 'general' }],
    ['a screenshot attached', { images: 1 }],
    ['no files wanted', { wantsProjectFiles: false }],
  ]
  for (const [label, patch] of offlineShapes) {
    assert.equal(onlineCodeAgentTurn({ ...onlineTurn, ...patch }), false, `${label} must stay offline`)
    assert.equal(onlineCodeAgentTurn({ ...onlineTurn, mode: undefined, ...patch }), false, `${label} must stay offline with no mode`)
  }
})

// --- 2. the offline loop makes zero network requests --------------------------

test('an offline code turn through LocalLlamaProvider fetches nothing', async () => {
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input))
    throw new Error(`offline chat must not make a network request: ${String(input)}`)
  }) as typeof fetch
  try {
    // A sidecar stand-in: the provider talks to this, never to a socket.
    const script = [
      { choices: [{ message: { role: 'assistant', content: '{"tool":"finish","arguments":{"summary":"Nothing to change."}}' }, finish_reason: 'stop' }] },
    ]
    let sent = 0
    const client = {
      async chat(): Promise<(typeof script)[number]> {
        sent += 1
        return script[sent - 1] ?? { choices: [{ message: { role: 'assistant', content: '{"tool":"finish","arguments":{"summary":"done"}}' }, finish_reason: 'stop' }] }
      },
      async chatCollect(_messages: ChatMessage[], _tools: readonly unknown[] | undefined, _signal: AbortSignal | undefined, _maxTokens: number, _extras: unknown, onDelta: (text: string) => void) {
        const res = await this.chat()
        onDelta(String(res.choices[0].message.content ?? ''))
        return res
      },
    }
    const complete = providerToComplete(new LocalLlamaProvider(client as never))
    const pack: ProjectContext = { snippets: [], files: [], tokens: 0, dropped: 0 }
    const search: ProjectSearch = { async context() { return pack } }
    const requests: CompletionRequest[] = []
    const result = await runCodeAgent('answer without tools', {
      root: tempDir().dir,
      rules: 'Follow the project style.',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 400,
      answerTokens: 200,
      mode: 'ask',
      search,
      async complete(req) {
        requests.push(req)
        return complete(req)
      },
      async ask() {
        return { allow: true }
      },
    })

    assert.equal(result.stopped, 'finish')
    assert.equal(sent, 1, 'one turn, straight to the local sidecar')
    assert.ok(requests.length >= 1)
    assert.deepEqual(calls, [], 'an offline turn makes zero network requests')
  } finally {
    globalThis.fetch = original
  }
})

test('the gateway base url is never contacted while the loop runs offline', async () => {
  const original = globalThis.fetch
  const touched: string[] = []
  globalThis.fetch = (async (input: unknown) => {
    touched.push(String(input))
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  try {
    const complete = providerToComplete(new LocalLlamaProvider({
      async chat() {
        return { choices: [{ message: { role: 'assistant', content: '{"tool":"finish","arguments":{"summary":"ok"}}' }, finish_reason: 'stop' }] }
      },
    } as never))
    const pack: ProjectContext = { snippets: [], files: [], tokens: 0, dropped: 0 }
    await runCodeAgent('finish right away', {
      root: tempDir().dir,
      rules: 'rules',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 400,
      answerTokens: 200,
      mode: 'ask',
      search: { async context() { return pack } },
      complete,
      async ask() {
        return { allow: true }
      },
    })
    const gatewayOrigin = new URL(GATEWAY).origin
    const toGateway = (url: string): boolean => {
      try {
        return new URL(url).origin === gatewayOrigin
      } catch {
        return false
      }
    }
    assert.deepEqual(touched.filter(toGateway), [], 'no request to the gateway base url')
  } finally {
    globalThis.fetch = original
  }
})

// --- 3. consent gates the offline history ------------------------------------

test('an online turn sees no earlier offline turns until the chat consents', () => {
  const history = [{ user: 'one', assistant: 'two' }, { user: 'three', assistant: 'four' }]
  assert.deepEqual(gatedHistory(history, false), [], 'no consent, no prior context leaves the device')
  assert.deepEqual(gatedHistory(history, true), history, 'consent sends the conversation as it stands')
})

test('consent is a per-chat flag stored on device, default off', () => {
  const p = tempDir()
  try {
    const first = '11111111-1111-4111-8111-111111111111'
    const second = '22222222-2222-4222-8222-222222222222'
    assert.deepEqual(readOnlineConsent(p.dir), {}, 'no file yet means no consent anywhere')
    assert.equal(onlineContextAllowed(readOnlineConsent(p.dir), first), false)

    writeOnlineConsent(p.dir, withOnlineConsent(readOnlineConsent(p.dir), first, true))
    const stored = readOnlineConsent(p.dir)
    assert.equal(onlineContextAllowed(stored, first), true, 'this chat consented')
    assert.equal(onlineContextAllowed(stored, second), false, 'and only this chat')

    // Revoking writes back a map without the entry, and an unreadable file is no consent.
    writeOnlineConsent(p.dir, withOnlineConsent(stored, first, false))
    assert.deepEqual(readOnlineConsent(p.dir), {})
    writeOnlineConsent(p.dir, { [first]: true, junk: false } as never)
    assert.deepEqual(readOnlineConsent(p.dir), { [first]: true }, 'only explicit consent is trusted')
  } finally {
    p.dispose()
  }
})
