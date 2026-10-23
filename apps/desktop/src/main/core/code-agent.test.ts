import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyEvent, type UiMsg } from '../../renderer/src/types.js'
import { CodeTrace } from '../../renderer/src/screens/CodeTrace.js'
import { fitAgentMessages } from './code-agent/budget.js'
import { applyUnifiedDiff, planEdit, unifiedDiff } from './code-agent/edit.js'
import { toolCallGbnf, toolCallJsonSchema } from './code-agent/grammar.js'
import { llamaCompletionExtras } from './code-agent/llama.js'
import { CODE_AGENT_LIMITS, nativeToolsRejected, runCodeAgent, type CompletionRequest } from './code-agent/loop.js'
import { parseModelTurn, repairJson } from './code-agent/parse-tool.js'
import { currentPermissionMode, decideApproval, exactCommand, permissionNeeded } from './code-agent/permission.js'
import { adaptCodeIndex, createProjectSearch, projectSearchFor, type ProjectContext } from './code-agent/project-search.js'
import { bundledSystemRulesPath, codeSystemPrompt, loadSystemRulesSync } from './code-agent/system-rules.js'
import { CODE_TOOL_NAMES } from './code-agent/tools.js'
import { readProjectFile, splitCommand } from './code-agent/workspace.js'
import { heuristicCounter } from './token-budget.js'

const chars: { name: string; count(text: string): Promise<number> } = {
  name: 'chars',
  count: async (text) => text.length,
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'surf-code-agent-'))
}

test('native tool calls win, and broken JSON is repaired', () => {
  assert.equal(parseModelTurn({
    content: 'ignore this prose',
    toolCalls: [{ name: 'functions.finish', arguments: '{"summary":"from native"}' }],
  })?.arguments.summary, 'from native')

  assert.equal(parseModelTurn({
    content: '```json\n{"tool":"finish","arguments":{"summary":"fenced",}}\n```',
  })?.arguments.summary, 'fenced')

  assert.equal(parseModelTurn({
    content: '{tool: "finish", arguments: {summary: "quoted"}}',
  })?.arguments.summary, 'quoted')

  assert.equal(parseModelTurn({
    content: `{'tool': 'finish', 'arguments': {'summary': 'single'}}`,
  })?.arguments.summary, 'single')

  assert.equal(parseModelTurn({
    content: '{"tool":"finish","arguments":{"summary":"open"}',
  })?.arguments.summary, 'open')

  assert.equal(parseModelTurn({
    content: 'Sure <tool_call>{"name":"finish","arguments":{"summary":"tagged"}}</tool_call>',
  })?.arguments.summary, 'tagged')

  assert.equal(parseModelTurn({
    content: '{"tool":"finish","arguments":"{\\"summary\\":\\"stringified\\"}"}',
  })?.arguments.summary, 'stringified')

  assert.equal(parseModelTurn({ content: 'I will just talk.' }), null)
  assert.deepEqual(repairJson('{"a":1,}'), { a: 1 })
})

test('grammar fallback exposes GBNF and json_schema for every tool', () => {
  const schema = toolCallJsonSchema()
  const grammar = toolCallGbnf()
  assert.equal(schema.type, 'json_schema')
  assert.deepEqual(schema.json_schema.schema.properties, {
    tool: { type: 'string', enum: [...CODE_TOOL_NAMES] },
    arguments: { type: 'object' },
  })
  assert.match(grammar, /^root ::= /)
  for (const name of CODE_TOOL_NAMES) assert.match(grammar, new RegExp(name))
  assert.deepEqual(llamaCompletionExtras({ responseFormat: schema }), { response_format: schema })
  assert.equal(llamaCompletionExtras({ grammar }).grammar, grammar)
})

test('prose falls back to json_schema, then to GBNF when that request fails', async () => {
  const seen: CompletionRequest[] = []
  const result = await runCodeAgent('do nothing', {
    ...baseHost(tempProject()),
    limits: { maxParseRetries: 3 },
    async complete(req) {
      seen.push(req)
      if (!req.responseFormat && !req.grammar) return { content: 'I will think about it.' }
      if (req.responseFormat) throw new Error('llama-server /v1/chat/completions: HTTP 400 response_format failed')
      return { content: '{"tool":"finish","arguments":{"summary":"Nothing to change."}}' }
    },
  })
  assert.equal(result.stopped, 'finish')
  assert.equal(result.answer, 'Nothing to change.')
  assert.equal(seen.length, 3)
  assert.ok(seen[0]?.tools)
  assert.ok(seen[1]?.responseFormat)
  assert.equal(seen[1]?.grammar, undefined)
  assert.match(seen[2]?.grammar ?? '', /read_file/)
  assert.equal(seen[2]?.tools, undefined)
  assert.equal(seen[2]?.messages.filter((message) => message.role === 'system').length, 1)
})

test('permission gate asks for new commands and for every edit', () => {
  assert.equal(currentPermissionMode(), 'ask')
  const allowed = new Set([exactCommand('npm test')])
  assert.equal(permissionNeeded('ask', allowed, { kind: 'command', command: 'npm test' }), false)
  assert.equal(permissionNeeded('ask', allowed, { kind: 'command', command: 'npm test --watch' }), true)
  assert.equal(permissionNeeded('ask', allowed, { kind: 'command', command: ' npm test ' }), false)
  assert.equal(permissionNeeded('ask', allowed, { kind: 'edit' }), true)
  const allowlist = new Set([exactCommand('npm test')])
  assert.equal(decideApproval('auto', { kind: 'command', command: 'rm -rf src/a.ts' }, { remembered: allowed, allowlist, checkpointPaths: new Set() }).action, 'deny')
  assert.equal(permissionNeeded('auto', allowed, { kind: 'edit' }, allowlist), false)
  assert.equal(permissionNeeded('auto', new Set(), { kind: 'command', command: 'npm test' }, allowlist), false)
  assert.equal(permissionNeeded('auto', new Set(), { kind: 'command', command: 'npm install' }, allowlist), true)
  assert.equal(permissionNeeded('auto', new Set(), { kind: 'command', command: 'node -p 1' }, allowlist), true)
  assert.equal(nativeToolsRejected(new Error('llama-server /v1/chat/completions: HTTP 400 tools are not supported')), true)
  assert.equal(nativeToolsRejected(new Error('connect ECONNREFUSED')), false)
})

test('ask mode shows a diff and does not write until apply', async () => {
  const root = tempProject()
  mkdirSync(join(root, 'src'))
  const file = join(root, 'src', 'a.ts')
  writeFileSync(file, 'export const n = 1\n')
  let asked = 0
  const result = await runCodeAgent('bump n', {
    ...baseHost(root),
    mode: 'ask',
    async complete() {
      if (asked === 0) {
        return { content: JSON.stringify({ tool: 'propose_edit', arguments: { path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 2' } }) }
      }
      return { content: '{"tool":"finish","arguments":{"summary":"Updated n."}}' }
    },
    async ask() {
      asked++
      assert.equal(readFileSync(file, 'utf8'), 'export const n = 1\n')
      return { allow: true }
    },
  })
  assert.equal(asked, 1)
  assert.equal(readFileSync(file, 'utf8'), 'export const n = 2\n')
  assert.equal(result.diffs[0]?.status, 'applied')
  assert.equal(result.stopped, 'finish')
  assert.match(result.diffs[0]?.diff ?? '', /^-export const n = 1/m)
  assert.match(result.diffs[0]?.diff ?? '', /^\+export const n = 2/m)
})

test('reject leaves the file alone, and a denied command does not run', async () => {
  const root = tempProject()
  const file = join(root, 'a.txt')
  writeFileSync(file, 'keep\n')
  const ran: string[] = []
  let step = 0
  await runCodeAgent('edit', {
    ...baseHost(root),
    async complete() {
      step++
      if (step === 1) return { content: '{"tool":"propose_edit","arguments":{"path":"a.txt","old":"keep","new":"changed"}}' }
      if (step === 2) return { content: '{"tool":"run_command","arguments":{"command":"npm test && rm -rf /"}}' }
      if (step === 3) return { content: '{"tool":"run_command","arguments":{"command":"node -e \\"process.stdout.write(1)\\""}}' }
      return { content: '{"tool":"finish","arguments":{"summary":"Stopped."}}' }
    },
    async ask() {
      return { allow: false }
    },
    async runCommand(command) {
      ran.push(command)
      return { ok: true, output: 'ran' }
    },
  })
  assert.equal(readFileSync(file, 'utf8'), 'keep\n')
  assert.deepEqual(ran, [])
})

test('an allowed command is not asked again, including after remember', async () => {
  const root = tempProject()
  const seen: string[] = []
  const remembered: string[] = []
  let step = 0
  await runCodeAgent('test', {
    ...baseHost(root),
    allowedCommands: ['npm test'],
    async complete() {
      step++
      if (step === 1) return { content: '{"tool":"run_command","arguments":{"command":"npm test"}}' }
      if (step === 2) return { content: '{"tool":"run_command","arguments":{"command":"npm run build"}}' }
      if (step === 3) return { content: '{"tool":"run_command","arguments":{"command":"npm run build"}}' }
      return { content: '{"tool":"finish","arguments":{"summary":"Tested."}}' }
    },
    async ask(request) {
      seen.push(request.command ?? '')
      return { allow: true, remember: true }
    },
    onRememberCommand(command) { remembered.push(command) },
    async runCommand(command) { return { ok: true, output: command } },
  })
  assert.deepEqual(seen, ['npm run build'])
  assert.deepEqual(remembered, ['npm run build'])
})

test('auto mode writes inside the project and pauses off the allowlist', async () => {
  const root = tempProject()
  writeFileSync(join(root, 'a.txt'), 'one\n')
  const asked: string[] = []
  const ran: string[] = []
  let step = 0
  await runCodeAgent('go', {
    ...baseHost(root),
    mode: 'auto',
    commandAllowlist: ['npm test'],
    async complete() {
      step++
      if (step === 1) return { content: '{"tool":"propose_edit","arguments":{"path":"a.txt","old":"one","new":"two"}}' }
      if (step === 2) return { content: '{"tool":"run_command","arguments":{"command":"npm test"}}' }
      if (step === 3) return { content: '{"tool":"run_command","arguments":{"command":"npm install left-pad"}}' }
      if (step === 4) return { content: '{"tool":"run_command","arguments":{"command":"rm -rf a.txt"}}' }
      return { content: '{"tool":"finish","arguments":{"summary":"Done."}}' }
    },
    async ask(request) { asked.push(request.command ?? request.kind); return { allow: false } },
    async runCommand(command) { ran.push(command); return { ok: true, output: 'ok' } },
  })
  assert.deepEqual(asked, ['npm install left-pad'])
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'two\n')
  assert.deepEqual(ran, ['npm test'])
})

test('project system.md replaces the bundled rules', () => {
  const root = tempProject()
  const bundled = join(root, 'bundled.md')
  writeFileSync(bundled, 'bundled rule\n')
  const plain = loadSystemRulesSync(root, bundled)
  assert.equal(plain.source, 'bundled')
  assert.equal(plain.text, 'bundled rule')
  mkdirSync(join(root, '.synap'))
  writeFileSync(join(root, '.synap', 'system.md'), '   \n')
  assert.equal(loadSystemRulesSync(root, bundled).text, 'bundled rule')
  writeFileSync(join(root, '.synap', 'system.md'), 'Use tabs.\n')
  const override = loadSystemRulesSync(root, bundled)
  assert.equal(override.source, 'project')
  assert.equal(override.text, 'Use tabs.')
  assert.match(codeSystemPrompt(override.text), /Use tabs\./)
  assert.doesNotMatch(codeSystemPrompt(override.text), /bundled rule/)
  const outside = join(tmpdir(), `surf-secret-${Date.now()}.txt`)
  writeFileSync(outside, 'root: secret')
  unlinkSync(join(root, '.synap', 'system.md'))
  symlinkSync(outside, join(root, '.synap', 'system.md'))
  const escaped = loadSystemRulesSync(root, bundled)
  assert.equal(escaped.source, 'bundled')
  assert.doesNotMatch(escaped.text, /secret/)
})

test('shipped system.md is the bundled default and states the three rules', () => {
  const path = bundledSystemRulesPath(false, '/missing', fileURLToPath(new URL('../../..', import.meta.url)))
  assert.match(path, /resources\/code\/system\.md$/)
  const text = readFileSync(path, 'utf8')
  assert.match(text, /coding style/i)
  assert.match(text, /small steps/i)
  assert.match(text, /run tests after edits/i)
  const loaded = loadSystemRulesSync(null, path)
  assert.equal(loaded.source, 'bundled')
  assert.match(codeSystemPrompt(loaded.text), /run tests after edits/i)
})

test('the step cap and a repeated call stop the loop', async () => {
  const root = tempProject()
  let reads = 0
  const capped = await runCodeAgent('read', {
    ...baseHost(root),
    limits: { maxSteps: 2, maxParseRetries: 0 },
    async complete() {
      reads++
      return { content: JSON.stringify({ tool: 'read_file', arguments: { path: `f${reads}.txt` } }) }
    },
  })
  assert.equal(capped.stopped, 'limit')
  assert.equal(capped.steps.length, 2)
  assert.equal(reads, 2)
  assert.equal(CODE_AGENT_LIMITS.maxSteps, 8)

  let calls = 0
  const repeated = await runCodeAgent('again', {
    ...baseHost(root),
    async complete() {
      calls++
      return { content: '{"tool":"read_file","arguments":{"path":"same.txt"}}' }
    },
  })
  assert.equal(repeated.stopped, 'repeat')
  assert.equal(calls, 2)
  assert.equal(repeated.steps.length, 1)
})

test('old tool results drop so the prompt stays inside the budget', async () => {
  const fitted = await fitAgentMessages(chars, [
    { role: 'system', content: 'rules' },
    { role: 'user', content: 'task' },
    { role: 'assistant', content: 'old' },
    { role: 'user', content: 'x'.repeat(500) },
    { role: 'user', content: 'latest question' },
  ], 80)
  const blob = fitted.map((message) => typeof message.content === 'string' ? message.content : '').join('\n')
  assert.equal(fitted[0]?.content, 'rules')
  assert.match(blob, /latest question/)
  assert.equal(blob.includes('x'.repeat(500)), false)

  const root = tempProject()
  writeFileSync(join(root, 'big.txt'), 'z'.repeat(400))
  const seen: string[] = []
  let step = 0
  await runCodeAgent('look', {
    ...baseHost(root),
    counter: chars,
    promptBudget: 180,
    observationTokens: 30,
    async complete(req) {
      step++
      seen.push(req.messages.map((message) => typeof message.content === 'string' ? message.content : '').join('\n'))
      if (step === 1) return { content: '{"tool":"read_file","arguments":{"path":"big.txt"}}' }
      return { content: '{"tool":"finish","arguments":{"summary":"Looked."}}' }
    },
  })
  assert.equal(seen[1]?.includes('z'.repeat(400)), false)
})

test('search_project uses ProjectSearch and a CodeIndex adapter plugs in', async () => {
  const root = tempProject()
  writeFileSync(join(root, 'alpha.ts'), 'alphaMark\n')
  writeFileSync(join(root, 'beta.ts'), 'betaMark\n')
  const search = createProjectSearch(root, { runner: 'substring' })
  const pack = await search.context('alphaMark', { tokenBudget: 40, maxSnippets: 8 })
  assert.equal(pack.files.length, 1)
  assert.equal(pack.files[0], 'alpha.ts')
  assert.ok(pack.snippets[0]?.text.includes('alphaMark'))
  assert.equal(pack.snippets[0]?.reason, 'search')
  assert.equal(pack.snippets[0]?.symbol, null)
  assert.ok(pack.tokens <= 40)

  const both = await search.context('Mark', { tokenBudget: 5, maxSnippets: 8 })
  assert.equal(both.snippets.length, 1)
  assert.ok(both.dropped >= 1)

  const index = {
    async context(task: string, options: { tokenBudget: number }): Promise<ProjectContext> {
      assert.equal(options.tokenBudget, 12)
      return {
        snippets: [{ path: 'src/run.ts', startLine: 4, endLine: 9, symbol: 'run', kind: 'function', text: task, reason: 'definition', score: 1 }],
        files: ['src/run.ts'],
        tokens: 2,
        dropped: 0,
      }
    },
  }
  const adapted = adaptCodeIndex(index)
  let seenBudget = 0
  const result = await runCodeAgent('find run', {
    ...baseHost(root),
    searchBudget: 12,
    search: adapted,
    async complete() {
      if (seenBudget === 0) {
        seenBudget = 1
        return { content: '{"tool":"search_project","arguments":{"query":"run"}}' }
      }
      return { content: '{"tool":"finish","arguments":{"summary":"Found run."}}' }
    },
  })
  assert.match(result.steps.find((step) => step.tool === 'search_project')?.detail ?? '', /1 snippet/)
})

test('an indexed project uses CodeIndex and an unindexed folder uses the stub', async () => {
  const root = tempProject()
  writeFileSync(join(root, 'alpha.ts'), 'alphaMark\n')
  const stub = projectSearchFor(root, null)
  const pack = await stub.context('alphaMark', { tokenBudget: 40 })
  assert.equal(pack.files[0], 'alpha.ts')
  assert.equal(pack.snippets[0]?.symbol, null)

  let seenBudget = 0
  const indexed = projectSearchFor(root, {
    async context(task, options) {
      seenBudget = options.tokenBudget
      return {
        snippets: [{ path: 'alpha.ts', startLine: 1, endLine: 1, symbol: 'alpha', kind: 'function', text: task, reason: 'search', score: 1 }],
        files: ['alpha.ts'],
        tokens: 1,
        dropped: 0,
      }
    },
  })
  const fromIndex = await indexed.context('alphaMark', { tokenBudget: 12, maxSnippets: 4 })
  assert.equal(seenBudget, 12)
  assert.equal(fromIndex.snippets[0]?.symbol, 'alpha')
})

test('paths outside the project and shell syntax are refused', () => {
  const root = tempProject()
  const outside = join(tmpdir(), `surf-outside-${Date.now()}.txt`)
  writeFileSync(outside, 'secret')
  symlinkSync(outside, join(root, 'link.txt'))
  assert.match(readProjectFile(root, { path: '../secret.txt' }), /outside/)
  assert.match(readProjectFile(root, { path: 'link.txt' }), /outside/)
  assert.equal(splitCommand('npm test && rm -rf /').ok, false)
  assert.equal(splitCommand('npm test | cat').ok, false)
  assert.deepEqual(splitCommand('npm test -- --grep "a b"'), { ok: true, argv: ['npm', 'test', '--', '--grep', 'a b'] })
  const planned = planEdit(root, { path: '../secret.txt', old: 'a', new: 'b' })
  assert.ok('error' in planned)
  const diff = unifiedDiff('a.txt', 'one\n', 'two\n')
  const applied = applyUnifiedDiff('one\n', diff)
  assert.equal(applied.ok && applied.text, 'two\n')
})

test('the chat step list and diff card render apply and reject', () => {
  const messageId = '11111111-1111-4111-8111-111111111111'
  const html = renderToStaticMarkup(createElement(CodeTrace, {
    messageId,
    steps: [
      { id: 'step-1', index: 1, tool: 'read_file', status: 'ok', title: 'Read src/a.ts', detail: '2 lines' },
      { id: 'step-2', index: 2, tool: 'run_command', status: 'waiting', title: 'Run npm test', detail: 'npm test' },
    ],
    diffs: [{ id: 'diff-1', stepId: 'step-3', path: 'src/a.ts', diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n', status: 'pending' }],
    onDecide: () => undefined,
  }))
  assert.match(html, /data-code-steps="yes"/)
  assert.match(html, /data-code-step="ok"/)
  assert.match(html, /data-code-step="waiting"/)
  assert.match(html, /data-code-allow="yes"/)
  assert.match(html, /data-code-diff="pending"/)
  assert.match(html, /data-code-apply="yes"/)
  assert.match(html, /data-code-reject="yes"/)
  assert.match(html, /src\/a\.ts/)

  const prev: UiMsg[] = [{ id: 'pending', role: 'assistant', text: '', sources: [], tools: [], pending: true }]
  const withStep = applyEvent(prev, {
    type: 'code-step',
    messageId,
    step: { id: 'step-1', index: 1, tool: 'read_file', status: 'running', title: 'Read src/a.ts', detail: '' },
  })
  const replaced = applyEvent(withStep, {
    type: 'code-step',
    messageId,
    step: { id: 'step-1', index: 1, tool: 'read_file', status: 'ok', title: 'Read src/a.ts', detail: '2 lines' },
  })
  const withDiff = applyEvent(replaced, {
    type: 'code-diff',
    messageId,
    diff: { id: 'diff-1', stepId: 'step-1', path: 'src/a.ts', diff: '+new\n', status: 'pending' },
  })
  assert.equal(withDiff[0]?.steps?.length, 1)
  assert.equal(withDiff[0]?.steps?.[0]?.status, 'ok')
  assert.equal(withDiff[0]?.diffs?.[0]?.status, 'pending')
  assert.equal(prev[0]?.steps, undefined)
})

test('the code agent never advertises or runs a web tool', async () => {
  const root = tempProject()
  const seen: string[] = []
  const turn = await runCodeAgent('find the beacon', {
    ...baseHost(root),
    async complete(req) {
      seen.push(...(req.tools ?? []).map((item) => (item as { function?: { name?: string } }).function?.name ?? ''))
      return { content: '{"tool":"web_search","arguments":{"query":"pier beacon"}}' }
    },
  })
  assert.equal(seen.includes('web_search'), false)
  assert.equal(seen.includes('fetch_page'), false)
  assert.ok(seen.includes('read_file'))
  // The call is not a code tool, so nothing runs and the loop gives up on parsing.
  assert.equal(turn.steps.length, 0)
  assert.deepEqual(turn.diffs, [])
  assert.equal(turn.stopped, 'parse')
  assert.match(turn.answer, /could not read a tool call/i)
})

function baseHost(root: string) {
  return {
    search: createProjectSearch(root, { runner: 'substring' as const }),
    root,
    rules: 'Follow the project style.',
    counter: heuristicCounter,
    promptBudget: 2000,
    searchBudget: 400,
    answerTokens: 200,
    mode: 'ask' as const,
    async complete(): Promise<{ content: string }> {
      return { content: '{"tool":"finish","arguments":{"summary":"Done."}}' }
    },
    async ask() {
      return { allow: true }
    },
  }
}
