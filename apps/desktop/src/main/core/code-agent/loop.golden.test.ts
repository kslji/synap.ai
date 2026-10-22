/**
 * Golden snapshot tests for the Code agent loop.
 *
 * These pin the loop's offline output (ordered steps, diffs, answer, stop reason)
 * and the CompletionRequest provider-contract shape (native -> json_schema -> gbnf)
 * byte-for-byte, so extracting the loop into @surf/agent-core is provably behavior-preserving.
 *
 * Run `UPDATE_SNAPSHOTS=1` to regenerate the committed .snap fixtures. They live in
 * __snapshots__/ and must match before and after the shared-core move.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { runCodeAgent, type CompletionRequest } from './loop.js'
import type { ModelTurn } from './parse-tool.js'
import type { ProjectContext, ProjectSearch } from './project-search.js'
import { heuristicCounter } from '../token-budget.js'

const snapshotDir = join(fileURLToPath(new URL('.', import.meta.url)), '__snapshots__')

/** Deterministic stringify: object keys sorted so JSON key order never leaks into the golden. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : 1)))
      : item,
    2,
  )
}

function matchSnapshot(name: string, actual: string): void {
  const file = join(snapshotDir, `${name}.snap`)
  const body = `# ${name}\n${actual}\n`
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    mkdirSync(snapshotDir, { recursive: true })
    writeFileSync(file, body, 'utf8')
    return
  }
  let expected: string
  try {
    expected = readFileSync(file, 'utf8')
  } catch {
    assert.fail(`missing golden ${name}.snap — run with UPDATE_SNAPSHOTS=1 to create it`)
  }
  assert.equal(body, expected, `golden ${name}.snap mismatch`)
}

/** A temp project inside the workspace so writes persist in sandboxed CI runners. */
function project(): { root: string; dispose(): void } {
  const base = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../.golden-tmp')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'loop-'))
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function fixedSearch(): ProjectSearch {
  const pack: ProjectContext = {
    snippets: [{ path: 'src/greet.ts', startLine: 1, endLine: 3, symbol: 'greet', kind: 'function', text: 'export function greet() {\n  return "hi"\n}', reason: 'search', score: 2 }],
    files: ['src/greet.ts'],
    tokens: 12,
    dropped: 0,
  }
  return { async context() { return pack } }
}

function summarize(req: CompletionRequest) {
  return {
    constraint: req.tools ? 'native' : req.responseFormat ? 'json_schema' : req.grammar ? 'gbnf' : 'none',
    toolNames: (req.tools ?? []).map((item) => (item as { function?: { name?: string } }).function?.name ?? '').filter(Boolean),
    responseFormatType: req.responseFormat?.type ?? null,
    grammarHasReadFile: typeof req.grammar === 'string' ? req.grammar.includes('read_file') : false,
    stepKind: req.stepKind ?? null,
    maxTokens: req.maxTokens,
    messageRoles: req.messages.map((message) => message.role),
    reminderPresent: req.messages.some((message) => typeof message.content === 'string' && message.content.includes('not a tool call')),
  }
}

test('golden: loop runs a multi-tool offline turn and stops on finish', async () => {
  const p = project()
  try {
    mkdirSync(join(p.root, 'src'), { recursive: true })
    writeFileSync(join(p.root, 'src', 'a.ts'), 'export const n = 1\n')
    writeFileSync(join(p.root, 'README.md'), '# Project\nhello\n')

    const requests: CompletionRequest[] = []
    const script: ModelTurn[] = [
      { content: '{"tool":"search_project","arguments":{"query":"greet"}}' },
      { content: null, toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"README.md"}' }] },
      { content: '{"tool":"propose_edit","arguments":{"path":"src/a.ts","old":"export const n = 1","new":"export const n = 2"}}' },
      { content: '{"tool":"run_command","arguments":{"command":"npm test"}}' },
      { content: '{"tool":"finish","arguments":{"summary":"Bumped n and ran the tests."}}' },
    ]
    let turn = 0
    const result = await runCodeAgent('bump n, then run tests', {
      root: p.root,
      rules: 'Follow the project style.',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 400,
      answerTokens: 200,
      observationTokens: 600,
      mode: 'ask',
      allowedCommands: ['npm test'],
      search: fixedSearch(),
      async complete(req) {
        requests.push(req)
        return script[turn++] ?? { content: '{"tool":"finish","arguments":{"summary":"fallback"}}' }
      },
      async ask() {
        return { allow: true }
      },
      async runCommand(command) {
        return { ok: true, output: `ran ${command}\n1 passing` }
      },
    })

    matchSnapshot('loop-multi-tool', canonical({
      answer: result.answer,
      stopped: result.stopped,
      steps: result.steps,
      diffs: result.diffs,
      requests: requests.map(summarize),
    }))
  } finally {
    p.dispose()
  }
})

test('golden: constraint ladder falls back native -> json_schema -> gbnf', async () => {
  const p = project()
  try {
    const requests: CompletionRequest[] = []
    const result = await runCodeAgent('do the thing', {
      root: p.root,
      rules: 'Follow the project style.',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 400,
      answerTokens: 200,
      mode: 'ask',
      limits: { maxParseRetries: 3 },
      search: fixedSearch(),
      async complete(req) {
        requests.push(req)
        // native returns prose (no tool), json_schema request throws, gbnf returns a finish call.
        if (!req.responseFormat && !req.grammar) return { content: 'I will think about it.' }
        if (req.responseFormat) throw new Error('llama-server /v1/chat/completions: HTTP 400 response_format failed')
        return { content: '{"tool":"finish","arguments":{"summary":"Nothing to change."}}' }
      },
      async ask() {
        return { allow: true }
      },
    })

    matchSnapshot('loop-constraint-ladder', canonical({
      answer: result.answer,
      stopped: result.stopped,
      steps: result.steps,
      requests: requests.map(summarize),
    }))
  } finally {
    p.dispose()
  }
})
