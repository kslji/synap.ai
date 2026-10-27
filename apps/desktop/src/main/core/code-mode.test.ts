import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { restoreAll, restoreCheckpoint } from './code-agent/checkpoint.js'
import { detectAllowlist, mergeAllowlist } from './code-agent/checks.js'
import { preparePatchSet, writePrepared } from './code-agent/patch.js'
import { applyPlanEdit } from './code-agent/plan.js'
import { readModeMap, projectMode, saveProjectMode } from './code-agent/mode-store.js'
import { decideApproval, effectiveMode, type ApprovalContext } from './code-agent/permission.js'
import { runCodeAgent, type CompletionRequest } from './code-agent/loop.js'
import { runSplitTask, type SplitHost } from './code-agent/split.js'
import type { ModelTurn } from './code-agent/parse-tool.js'
import { CodeModeBar, CodeTrace } from '../../renderer/src/screens/CodeTrace.js'
import { heuristicCounter } from './token-budget.js'

function tempDir(): string {
  // realpath: on macOS tmpdir() is /var/folders/... (a symlink to /private/var/...).
  // Patch paths stay project-relative now, but keep the root real so fs checks match.
  return realpathSync(mkdtempSync(join(tmpdir(), 'surf-mode-')))
}

function gate(partial: Partial<ApprovalContext> = {}): ApprovalContext {
  return {
    remembered: partial.remembered ?? new Set(),
    allowlist: partial.allowlist ?? new Set(),
    checkpointPaths: partial.checkpointPaths ?? new Set(),
  }
}

test('ask mode asks before every write and every new command', () => {
  const ctx = gate({ remembered: new Set(['npm test']) })
  assert.equal(decideApproval('ask', { kind: 'edit' }, ctx).action, 'ask')
  assert.equal(decideApproval('ask', { kind: 'command', command: 'npm test' }, ctx).action, 'allow')
  assert.equal(decideApproval('ask', { kind: 'command', command: 'npm run build' }, ctx).action, 'ask')
  assert.equal(effectiveMode(null, 'auto', false), 'ask')
  assert.equal(effectiveMode('ask', 'auto', true), 'ask')
})

test('auto allowlist runs checks and pauses on install, network, and unknown commands', () => {
  const ctx = gate({ allowlist: new Set(['npm test', 'npm run build']), remembered: new Set(['pytest']) })
  assert.equal(decideApproval('auto', { kind: 'edit' }, ctx).action, 'allow')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'npm test' }, ctx).action, 'allow')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'pytest' }, ctx).action, 'allow')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'npm run build' }, ctx).action, 'allow')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'node -p 1' }, ctx).action, 'ask')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'npm install left-pad' }, ctx).action, 'ask')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'curl https://example.test' }, ctx).action, 'ask')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'npm test && curl https://example.test' }, ctx).action, 'deny')
})

test('auto refuses deletes outside the run checkpoints and pauses on the ones it owns', () => {
  const ctx = gate({ allowlist: new Set(['npm test']), checkpointPaths: new Set(['src/new.ts']) })
  assert.equal(decideApproval('auto', { kind: 'command', command: 'rm -rf src/a.ts' }, ctx).action, 'deny')
  assert.equal(decideApproval('ask', { kind: 'command', command: 'rm src/a.ts' }, ctx).action, 'deny')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'rm src/new.ts' }, ctx).action, 'ask')
  assert.equal(decideApproval('auto', { kind: 'command', command: 'git reset --hard' }, ctx).action, 'ask')
})

test('the allowlist is detected from the project and drops install scripts', () => {
  const root = tempDir()
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      scripts: {
        test: 'vitest run',
        lint: 'eslint .',
        typecheck: 'tsc --noEmit',
        build: 'npm install && node build.js',
      },
    }))
    writeFileSync(join(root, 'pyproject.toml'), '[build-system]\nrequires = ["setuptools"]\n')
    const detected = detectAllowlist(root)
    assert.ok(detected.includes('npm test'))
    assert.ok(detected.includes('npm run lint'))
    assert.ok(detected.includes('npm run typecheck'))
    assert.equal(detected.includes('npm run build'), false)
    const merged = mergeAllowlist(detected, ['npm test', 'npm install', 'pytest -q'])
    assert.equal(merged.filter((command) => command === 'npm test').length, 1)
    assert.equal(merged.includes('npm install'), false)
    assert.ok(merged.includes('pytest -q'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('project mode is ask until saved, and auto stays off until it is confirmed', () => {
  const dir = tempDir()
  const root = join(dir, 'project')
  try {
    assert.equal(projectMode(readModeMap(dir), root, 'ask', false), 'ask')
    assert.equal(projectMode(readModeMap(dir), root, 'auto', false), 'ask')
    saveProjectMode(dir, root, 'auto')
    assert.equal(readModeMap(dir)[root], 'auto')
    assert.equal(projectMode(readModeMap(dir), root, 'ask', false), 'ask')
    assert.equal(projectMode(readModeMap(dir), root, 'ask', true), 'auto')
    saveProjectMode(dir, root, 'ask')
    assert.equal(projectMode(readModeMap(dir), root, 'auto', true), 'ask')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ask mode does not write or run until the user allows it', async () => {
  const root = tempDir()
  const file = join(root, 'src', 'a.ts')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(file, 'export const n = 1\n')
  writeFileSync(join(root, 'src', 'b.ts'), 'export const m = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }))
  const ran: string[] = []
  let sawWrite = false
  const editTurn = { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 2' }] }) }
  const complete = async (req: CompletionRequest): Promise<ModelTurn> => text(req).includes('Kind: plan')
    ? { content: JSON.stringify({ steps: [{ id: 's1', goal: 'bump n', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'typecheck', command: '' }, create: false }] }) }
    : editTurn
  try {
    const denied = await runSplitTask('Fix the typo in src/a.ts and src/b.ts, and leave package.json alone', host(root, complete, async (command) => {
      ran.push(command)
      return { ok: true, output: 'ok' }
    }, async () => {
      sawWrite = readFileSync(file, 'utf8').includes('export const n = 2')
      return { allow: false }
    }))
    assert.equal(sawWrite, false)
    assert.equal(denied.stopped, 'cancelled')
    assert.equal(readFileSync(file, 'utf8'), 'export const n = 1\n')
    assert.deepEqual(ran, [])

    const allowed = await runSplitTask('Fix the typo in src/a.ts and src/b.ts, and leave package.json alone', host(root, complete, async () => ({ ok: true, output: 'ok' }), async (request) => {
      if (request.kind === 'edit') assert.equal(readFileSync(file, 'utf8'), 'export const n = 1\n')
      return { allow: true }
    }))
    assert.equal(allowed.stopped, 'finish')
    assert.equal(readFileSync(file, 'utf8'), 'export const n = 2\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('auto runs an allow-listed check and pauses before an install', async () => {
  const root = tempDir()
  const file = join(root, 'src', 'a.ts')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(file, 'export const n = 1\n')
  writeFileSync(join(root, 'src', 'b.ts'), 'export const m = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  const ran: string[] = []
  const asked: string[] = []
  try {
    const result = await runSplitTask('Fix the typo in src/a.ts and src/b.ts, and leave package.json alone', {
      ...host(root, async (req) => {
        const user = text(req)
        if (user.includes('Kind: plan')) {
          return { content: JSON.stringify({ steps: [{ id: 's1', goal: 'bump n', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false }] }) }
        }
        return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 3' }] }) }
      }, async (command) => {
        ran.push(command)
        return { ok: true, output: 'ok' }
      }, async (request) => {
        asked.push(request.command ?? request.kind)
        return { allow: false }
      }),
      mode: 'auto',
      commandAllowlist: ['npm test'],
    })
    assert.equal(result.stopped, 'finish')
    assert.equal(readFileSync(file, 'utf8'), 'export const n = 3\n')
    assert.ok(ran.includes('npm test'))
    assert.equal(asked.includes('edit'), false)
    assert.equal(asked.includes('npm test'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stop keeps the finished step undoable and undo all restores the start', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'src/b.ts'), 'export const m = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  const ac = new AbortController()
  let asks = 0
  try {
    const result = await runSplitTask('Refactor the constant in src/a.ts and src/b.ts, and leave package.json alone', {
      ...host(root, async (req) => {
        const user = text(req)
        if (user.includes('Kind: plan')) {
          return {
            content: JSON.stringify({
              steps: [
                { id: 'a', goal: 'bump a', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false },
                { id: 'b', goal: 'bump b', files: ['src/b.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false },
              ],
            }),
          }
        }
        if (user.includes('bump a')) return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 2' }] }) }
        return { content: JSON.stringify({ edits: [{ path: 'src/b.ts', old: 'export const m = 1', new: 'export const m = 2' }] }) }
      }, async () => ({ ok: true, output: 'ok' }), async () => {
        asks += 1
        if (asks > 2) {
          ac.abort()
          const error = new Error('aborted')
          error.name = 'AbortError'
          throw error
        }
        return { allow: true }
      }),
      signal: ac.signal,
      reviewPlan: async (steps) => steps.map((step) => step.id),
    })
    assert.equal(result.stopped, 'stopped')
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 2\n')
    assert.equal(readFileSync(join(root, 'src/b.ts'), 'utf8'), 'export const m = 1\n')
    assert.equal(result.checkpoints.length, 1)
    const checkpoint = result.checkpoints[0]
    assert.ok(checkpoint)
    restoreCheckpoint(checkpoint)
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 1\n')

    writeFileSync(join(root, 'src/a.ts'), 'export const n = 2\n')
    writeFileSync(join(root, 'src/b.ts'), 'export const m = 2\n')
    const first = { stepId: 'a', root, files: [{ path: 'src/a.ts', existed: true, text: 'export const n = 1\n' }] }
    const second = { stepId: 'b', root, files: [{ path: 'src/b.ts', existed: true, text: 'export const m = 1\n' }] }
    restoreAll([first, second])
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 1\n')
    assert.equal(readFileSync(join(root, 'src/b.ts'), 'utf8'), 'export const m = 1\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a goal edit is kept and a nested file is not created before the write', () => {
  const steps = [
    { id: 'a', goal: 'first', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'test' as const, command: 'npm test' }, create: false },
    { id: 'b', goal: 'second', files: ['src/b.ts'], symbols: [], depends_on: [], check: { kind: 'test' as const, command: 'npm test' }, create: false },
  ]
  const edited = applyPlanEdit(steps, ['b', 'a'], [{ id: 'b', goal: '  renamed step  ' }])
  assert.deepEqual(edited.map((step) => step.id), ['b', 'a'])
  assert.equal(edited[0]?.goal, 'renamed step')

  const root = tempDir()
  try {
    const prepared = preparePatchSet(root, [{ path: 'nested/fresh.ts', old: '', new: 'export const n = 1\n' }], { allowCreate: true, allowedPaths: null })
    assert.equal(prepared.ok, true)
    assert.equal(existsSync(join(root, 'nested')), false)
    if (prepared.ok) writePrepared(prepared.files)
    assert.match(readFileSync(join(root, 'nested/fresh.ts'), 'utf8'), /export const n = 1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accept all applies later edits and still asks before a command', async () => {
  const root = tempDir()
  writeFileSync(join(root, 'a.txt'), 'one\n')
  const asked: string[] = []
  const ran: string[] = []
  let step = 0
  try {
    await runCodeAgent('go', {
      root,
      rules: '',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 200,
      answerTokens: 200,
      mode: 'ask',
      search: { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } },
      async complete() {
        step += 1
        if (step === 1) return { content: JSON.stringify({ tool: 'propose_edit', arguments: { path: 'a.txt', old: 'one', new: 'two' } }) }
        if (step === 2) return { content: JSON.stringify({ tool: 'propose_edit', arguments: { path: 'a.txt', old: 'two', new: 'three' } }) }
        if (step === 3) return { content: JSON.stringify({ tool: 'run_command', arguments: { command: 'npm test' } }) }
        return { content: '{"tool":"finish","arguments":{"summary":"Done."}}' }
      },
      async ask(request) {
        asked.push(request.kind)
        return { allow: true, all: request.kind === 'edit' }
      },
      async runCommand(command) {
        ran.push(command)
        return { ok: true, output: 'ok' }
      },
    })
    assert.deepEqual(asked, ['edit', 'command'])
    assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'three\n')
    assert.deepEqual(ran, ['npm test'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a finish that skipped a file the request named is sent back once', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'src/b.ts'), 'export const b = 1\n')
  const requests: string[] = []
  let turn = 0
  try {
    const result = await runCodeAgent('Bump the constants in src/a.ts and src/b.ts to 2', {
      root,
      rules: '',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 200,
      answerTokens: 200,
      mode: 'auto',
      search: { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } },
      async complete(req) {
        requests.push(req.messages.map((message) => String(message.content ?? '')).join('\n'))
        turn += 1
        if (turn === 1) return { content: JSON.stringify({ tool: 'propose_edit', arguments: { path: 'src/a.ts', old: 'a = 1', new: 'a = 2' } }) }
        if (turn === 2) return { content: '{"tool":"finish","arguments":{"summary":"Bumped both."}}' }
        if (turn === 3) return { content: JSON.stringify({ tool: 'propose_edit', arguments: { path: 'src/b.ts', old: 'b = 1', new: 'b = 2' } }) }
        return { content: '{"tool":"finish","arguments":{"summary":"Bumped both."}}' }
      },
      async ask() { return { allow: true } },
      async runCommand() { return { ok: true, output: '' } },
    })
    assert.equal(turn, 4)
    assert.equal(result.stopped, 'finish')
    // The refused finish names the file that nothing touched.
    assert.match(requests[2] ?? '', /src\/b\.ts/)
    assert.match(requests[2] ?? '', /nothing was changed there/)
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const a = 2\n')
    assert.equal(readFileSync(join(root, 'src/b.ts'), 'utf8'), 'export const b = 2\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the code agent shows the mode toggle, accept all, step edit, and undo all', () => {
  const messageId = '11111111-1111-4111-8111-111111111111'
  const mode = renderToStaticMarkup(createElement(CodeModeBar, {
    mode: 'ask',
    confirming: true,
    onChoose: () => undefined,
    onConfirm: () => undefined,
    onCancel: () => undefined,
  }))
  assert.match(mode, /data-code-mode="ask"/)
  assert.match(mode, /data-code-mode-auto="yes"/)
  assert.match(mode, /data-code-auto-confirm="yes"/)
  assert.match(mode, /Enable Auto/)

  const html = renderToStaticMarkup(createElement(CodeTrace, {
    messageId,
    steps: [{ id: 's1:check', index: 1, tool: 'check', status: 'waiting', title: 'Check test', detail: 'npm test' }],
    diffs: [{ id: 'd1', stepId: 's1', path: 'src/a.ts', diff: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-export const n = 1\n+export const n = 2\n', status: 'pending' }],
    plan: {
      status: 'review',
      steps: [{ id: 's1', index: 1, goal: 'Bump n', files: ['src/a.ts'], symbols: [], dependsOn: [], check: 'test: npm test', create: false }],
    },
    onDecide: () => undefined,
    onRevise: () => undefined,
    onUndo: () => undefined,
    onUndoAll: () => undefined,
  }))
  assert.match(html, /data-code-plan-edit="s1"/)
  assert.match(html, /data-code-accept-all="yes"/)
  assert.match(html, /Always allow this command for this project/)

  const done = renderToStaticMarkup(createElement(CodeTrace, {
    messageId,
    steps: [],
    diffs: [],
    plan: {
      status: 'done',
      steps: [{ id: 's1', index: 1, goal: 'Bump n', files: ['src/a.ts'], symbols: [], dependsOn: [], check: 'test: npm test', create: false }],
      undos: [{ stepId: 's1', title: 'Bump n' }],
    },
    onUndo: () => undefined,
    onUndoAll: () => undefined,
  }))
  assert.match(done, /data-code-undo="s1"/)
  assert.match(done, /data-code-undo-all="yes"/)
})

function text(req: CompletionRequest): string {
  const last = req.messages.at(-1)?.content
  return typeof last === 'string' ? last : ''
}

function host(
  root: string,
  complete: (req: CompletionRequest) => Promise<ModelTurn>,
  runCommand: (command: string) => Promise<{ ok: boolean; output: string }>,
  ask: SplitHost['ask'],
): SplitHost {
  return {
    root,
    facts: { indexed: true, files: ['src/a.ts', 'src/b.ts'], symbols: [], edges: [] },
    rules: 'Follow the project style.',
    counter: heuristicCounter,
    promptBudget: 2000,
    searchBudget: 400,
    answerTokens: 400,
    mode: 'ask',
    search: { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } },
    complete,
    ask,
    runCommand,
  }
}
