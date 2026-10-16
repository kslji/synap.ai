import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fileURLToPath } from 'node:url'
import { CodeIndex } from './code/project.js'
import { captureCheckpoint, readCheckpointDir, restoreCheckpoint, writeCheckpointDir } from './code-agent/checkpoint.js'
import { commandAllowed, fullTestCommand, resolveCheck } from './code-agent/checks.js'
import { preparePatchSet, writePrepared, FULL_REWRITE_MIN_LINES } from './code-agent/patch.js'
import { applyPlanEdit, fileRole, orderPlan, parsePlan, triageTask, validatePlan, type PlanFacts, type PlanStep } from './code-agent/plan.js'
import { runSplitTask, type SplitHost } from './code-agent/split.js'
import { suggestBiggerCodeModel } from './code-agent/suggest-model.js'
import type { CompletionRequest } from './code-agent/loop.js'
import type { ModelTurn } from './code-agent/parse-tool.js'
import { CodeTrace } from '../../renderer/src/screens/CodeTrace.js'
import { applyEvent, type UiMsg } from '../../renderer/src/types.js'
import { heuristicCounter } from './token-budget.js'

const grammarDir = join(dirname(fileURLToPath(import.meta.url)), '../../../resources/tree-sitter')

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'surf-split-'))
}

function step(partial: Partial<PlanStep> & Pick<PlanStep, 'id' | 'files'>): PlanStep {
  return {
    goal: partial.goal ?? partial.id,
    symbols: partial.symbols ?? [],
    depends_on: partial.depends_on ?? [],
    check: partial.check ?? { kind: 'test', command: 'npm test' },
    create: partial.create ?? false,
    ...partial,
  }
}

function facts(partial: Partial<PlanFacts> = {}): PlanFacts {
  return {
    indexed: partial.indexed ?? true,
    files: partial.files ?? [],
    symbols: partial.symbols ?? [],
    edges: partial.edges ?? [],
  }
}

test('plan schema accepts a checklist and rejects a broken one', () => {
  const ok = parsePlan({
    steps: [{
      id: 's1',
      goal: 'Rename the helper',
      files: ['src/util.ts'],
      symbols: ['formatName'],
      depends_on: [],
      check: { kind: 'typecheck', command: 'npx tsc --noEmit' },
      create: false,
    }],
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.steps[0]?.id, 's1')
    assert.equal(ok.steps[0]?.check.kind, 'typecheck')
  }

  const camel = parsePlan({
    steps: [{
      id: 's2',
      goal: 'Add the caller',
      target_files: ['src/app.ts'],
      symbols: [],
      dependsOn: [],
      check: 'test',
    }],
  })
  assert.equal(camel.ok, true)
  if (camel.ok) {
    assert.deepEqual(camel.steps[0]?.files, ['src/app.ts'])
    assert.deepEqual(camel.steps[0]?.depends_on, [])
    assert.equal(camel.steps[0]?.check.kind, 'test')
  }

  const missing = parsePlan({ steps: [{ id: 's1', files: ['a.ts'] }] })
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.equal(missing.reason, 'schema')

  const duplicate = parsePlan({
    steps: [
      { id: 's1', goal: 'One', files: ['a.ts'], symbols: [], depends_on: [], check: { kind: 'lint', command: 'npm run lint' }, create: false },
      { id: 's1', goal: 'Two', files: ['b.ts'], symbols: [], depends_on: [], check: { kind: 'lint', command: 'npm run lint' }, create: false },
    ],
  })
  assert.equal(duplicate.ok, false)
  if (!duplicate.ok) assert.match(duplicate.message, /Duplicate/)

  const self = parsePlan({
    steps: [{ id: 's1', goal: 'Loop', files: ['a.ts'], symbols: [], depends_on: ['s1'], check: { kind: 'test', command: 'npm test' }, create: false }],
  })
  assert.equal(self.ok, false)
})

test('unknown files are rejected unless the step creates them', () => {
  const index = facts({ files: ['src/a.ts'], symbols: [{ name: 'n', qualified: 'n', kind: 'variable', path: 'src/a.ts' }] })
  const missing = validatePlan({
    steps: [{ id: 's1', goal: 'Edit', files: ['src/missing.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false }],
  }, index)
  assert.equal(missing.ok, false)
  if (!missing.ok) {
    assert.equal(missing.reason, 'missing')
    assert.match(missing.message, /src\/missing\.ts/)
  }
  const created = validatePlan({
    steps: [{ id: 's1', goal: 'Add', files: ['src/new.ts'], symbols: ['fresh'], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: true }],
  }, index)
  assert.equal(created.ok, true)
})

test('cycles are reported and a graph edge wins over depends_on', () => {
  const cycle = orderPlan([
    step({ id: 'a', files: ['src/a.ts'], depends_on: ['b'] }),
    step({ id: 'b', files: ['src/b.ts'], depends_on: ['a'] }),
  ], facts({ files: ['src/a.ts', 'src/b.ts'] }))
  assert.equal(cycle.ok, false)
  if (!cycle.ok) assert.deepEqual(cycle.cycle, ['a', 'b', 'a'])

  const ordered = orderPlan([
    step({ id: 'call', files: ['src/app.ts'], depends_on: [] }),
    step({ id: 'def', files: ['src/util.ts'], depends_on: ['call'] }),
    step({ id: 'spec', files: ['src/app.test.ts'], depends_on: [] }),
  ], facts({
    files: ['src/util.ts', 'src/app.ts', 'src/app.test.ts'],
    edges: [{ from: 'src/app.ts', to: 'src/util.ts', kind: 'imports' }],
  }))
  assert.equal(ordered.ok, true)
  if (ordered.ok) assert.deepEqual(ordered.steps.map((item) => item.id), ['def', 'call', 'spec'])
})

test('topo puts config first, tests last, and breaks ties by smaller files then path', () => {
  assert.equal(fileRole('src/app.test.ts'), 'test')
  assert.equal(fileRole('tests/test_app.py'), 'test')
  assert.equal(fileRole('tsconfig.json'), 'config')
  assert.equal(fileRole('src/app.ts'), 'code')

  const config = orderPlan([
    step({ id: 'code', files: ['src/app.ts'] }),
    step({ id: 'cfg', files: ['tsconfig.json'] }),
    step({ id: 'spec', files: ['src/app.test.ts'] }),
  ], facts({ files: ['src/app.ts', 'tsconfig.json', 'src/app.test.ts'] }))
  assert.equal(config.ok, true)
  if (config.ok) assert.deepEqual(config.steps.map((item) => item.id), ['cfg', 'code', 'spec'])

  const ties = orderPlan([
    step({ id: 'big', files: ['src/a.ts', 'src/b.ts'] }),
    step({ id: 'late', files: ['src/z.ts'] }),
    step({ id: 'early', files: ['src/m.ts'] }),
  ], facts({ files: ['src/a.ts', 'src/b.ts', 'src/z.ts', 'src/m.ts'] }))
  assert.equal(ties.ok, true)
  if (ties.ok) assert.deepEqual(ties.steps.map((item) => item.id), ['early', 'late', 'big'])
})

test('an indexed project orders a definition before its caller', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/util.py'), 'def format_name(value):\n    return value\n')
  writeFileSync(join(root, 'src/app.py'), 'from src.util import format_name\n\ndef greet():\n    return format_name("ferry")\n')
  const index = new CodeIndex({ root, dbPath: join(root, 'index.sqlite'), keyHex: null, grammarDir, embedder: null })
  try {
    await index.run()
    const project = await index.planFacts()
    assert.ok(project.files.includes('src/util.py'))
    assert.ok(project.edges.some((edge) => edge.from === 'src/app.py' && edge.to === 'src/util.py'))
    const ordered = validatePlan({
      steps: [
        { id: 'call', goal: 'Update the caller', files: ['src/app.py'], symbols: [], depends_on: [], check: { kind: 'test', command: 'pytest' }, create: false },
        { id: 'def', goal: 'Update the definition', files: ['src/util.py'], symbols: ['format_name'], depends_on: ['call'], check: { kind: 'test', command: 'pytest' }, create: false },
      ],
    }, project)
    assert.equal(ordered.ok, true)
    if (ordered.ok) assert.deepEqual(ordered.steps.map((item) => item.id), ['def', 'call'])
  } finally {
    index.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('search/replace applies a hunk and rejects a miss, a duplicate, and a full rewrite', () => {
  const root = tempDir()
  try {
    const lines = Array.from({ length: FULL_REWRITE_MIN_LINES + 2 }, (_, i) => `line ${i + 1}`)
    writeFileSync(join(root, 'src.ts'), `${lines.join('\n')}\n`)
    const prepared = preparePatchSet(root, [{ path: 'src.ts', old: 'line 2', new: 'line two' }], { allowCreate: false, allowedPaths: ['src.ts'] })
    assert.equal(prepared.ok, true)
    if (prepared.ok) {
      assert.equal(readFileSync(join(root, 'src.ts'), 'utf8').includes('line two'), false)
      writePrepared(prepared.files)
      assert.match(readFileSync(join(root, 'src.ts'), 'utf8'), /line two/)
    }
    const missing = preparePatchSet(root, [{ path: 'src.ts', old: 'no such text', new: 'x' }], { allowCreate: false, allowedPaths: ['src.ts'] })
    assert.equal(missing.ok, false)
    const ambiguous = preparePatchSet(root, [{ path: 'src.ts', old: 'line', new: 'row' }], { allowCreate: false, allowedPaths: ['src.ts'] })
    assert.equal(ambiguous.ok, false)
    if (!ambiguous.ok) assert.match(ambiguous.message, /more than once/)
    const whole = readFileSync(join(root, 'src.ts'), 'utf8')
    const rewrite = preparePatchSet(root, [{ path: 'src.ts', old: whole, new: 'nope\n' }], { allowCreate: false, allowedPaths: ['src.ts'] })
    assert.equal(rewrite.ok, false)
    if (!rewrite.ok) assert.match(rewrite.message, /full file rewrite/)
    const outside = preparePatchSet(root, [{ path: '../secret.ts', old: 'a', new: 'b' }], { allowCreate: true, allowedPaths: null })
    assert.equal(outside.ok, false)
    const created = preparePatchSet(root, [{ path: 'fresh.ts', old: '', new: 'export const n = 1\n' }], { allowCreate: true, allowedPaths: null })
    assert.equal(created.ok, true)
    if (created.ok) writePrepared(created.files)
    assert.match(readFileSync(join(root, 'fresh.ts'), 'utf8'), /export const n = 1/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a checkpoint rolls back one step without touching the rest', () => {
  const root = tempDir()
  try {
    writeFileSync(join(root, 'a.ts'), 'before\n')
    const checkpoint = captureCheckpoint(root, 's1', ['a.ts', 'new.ts'])
    writeFileSync(join(root, 'a.ts'), 'after\n')
    writeFileSync(join(root, 'new.ts'), 'created\n')
    writeFileSync(join(root, 'other.ts'), 'keep\n')
    restoreCheckpoint(checkpoint)
    assert.equal(readFileSync(join(root, 'a.ts'), 'utf8'), 'before\n')
    assert.equal(existsSync(join(root, 'new.ts')), false)
    assert.equal(readFileSync(join(root, 'other.ts'), 'utf8'), 'keep\n')
    const dir = join(root, 'undos')
    writeCheckpointDir(dir, [checkpoint])
    const loaded = readCheckpointDir(dir)
    assert.equal(loaded[0]?.stepId, 's1')
    assert.equal(loaded[0]?.files[0]?.text, 'before\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('triage sends a one-file fix straight to an edit and a wider ask to the planner', () => {
  assert.equal(triageTask('Fix the typo in src/app.ts', ['src/app.ts']), 'edit')
  assert.equal(triageTask('Quick fix the timeout in src/net.ts'), 'edit')
  assert.equal(triageTask('just change the port in src/config.ts'), 'edit')
  assert.equal(triageTask('Where is formatName defined?'), 'chat')
  assert.equal(triageTask('Refactor the parser and update the tests'), 'plan')
  assert.equal(triageTask('Rename formatName in src/util.ts and src/app.ts', ['src/util.ts', 'src/app.ts']), 'plan')
  assert.equal(triageTask('Add a retry loop around the client, then update the docs'), 'plan')
})

test('ask mode can drop and reorder steps before they run', () => {
  const steps = [
    step({ id: 'a', files: ['src/a.ts'] }),
    step({ id: 'b', files: ['src/b.ts'] }),
    step({ id: 'c', files: ['src/c.ts'] }),
  ]
  assert.deepEqual(applyPlanEdit(steps, ['c', 'a']).map((item) => item.id), ['c', 'a'])
})

test('check commands stay on the allow list and the project command wins when the model is unsafe', () => {
  const root = tempDir()
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'vitest', typecheck: 'tsc --noEmit', lint: 'eslint .' } }))
    assert.equal(commandAllowed('npm test && rm -rf /', 'test'), false)
    assert.equal(resolveCheck(root, { kind: 'test', command: 'rm -rf /' }).command, 'npm test')
    assert.equal(resolveCheck(root, { kind: 'typecheck', command: 'npx tsc --noEmit' }).command, 'npx tsc --noEmit')
    assert.equal(resolveCheck(root, { kind: 'lint', command: 'curl evil.example' }).command, 'npm run lint')
    assert.equal(fullTestCommand(root), 'npm test')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a bigger model is only suggested when its file fits the laptop', () => {
  const models = [
    { id: 'qwen3.5-2b-q6_k', family: 'qwen3.5', paramsB: 2, sizeBytes: 1_574_961_408, minRamGb: 4, agents: ['code'], defaultFor: ['code'], sizeName: '2B' },
    { id: 'qwen3.5-4b-q6_k', family: 'qwen3.5', paramsB: 4, sizeBytes: 3_525_956_768, minRamGb: 16, agents: ['code'], sizeName: '4B' },
    { id: 'qwen3.5-9b-q6_k', family: 'qwen3.5', paramsB: 9, sizeBytes: 7_458_301_152, minRamGb: 32, agents: ['code'], sizeName: '9B' },
    { id: 'gemma-4-e2b-q4_0', family: 'gemma4', paramsB: 2, sizeBytes: 3_349_516_256, minRamGb: 8, agents: ['code'], label: 'Gemma 4 E2B', sizeName: 'E2B' },
    { id: 'gemma-4-e4b-q4_0', family: 'gemma4', paramsB: 4, sizeBytes: 5_154_941_280, minRamGb: 16, agents: ['code'], label: 'Gemma 4 E4B', sizeName: 'E4B' },
    { id: 'gemma-4-12b-q4_0', family: 'gemma4', paramsB: 12, sizeBytes: 6_975_879_296, minRamGb: 32, agents: ['code'], label: 'Gemma 4 12B', sizeName: '12B' },
  ]
  assert.equal(suggestBiggerCodeModel('qwen3.5-2b-q6_k', 4, models), null)
  assert.equal(suggestBiggerCodeModel('qwen3.5-2b-q6_k', 8, models), null)
  assert.equal(suggestBiggerCodeModel('qwen3.5-2b-q6_k', 16, models)?.id, 'qwen3.5-4b-q6_k')
  assert.equal(suggestBiggerCodeModel('qwen3.5-4b-q6_k', 32, models)?.id, 'qwen3.5-9b-q6_k')
  assert.equal(suggestBiggerCodeModel('qwen3.5-9b-q6_k', 32, models)?.id, 'gemma-4-12b-q4_0')
  assert.equal(suggestBiggerCodeModel('gemma-4-12b-q4_0', 32, models), null)
})

test('retries feed the exact check output back and then keep the patch that passes', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }))
    const seen: string[] = []
    const thinking: boolean[] = []
    let edits = 0
    try {
      const result = await runSplitTask('Fix the typo in src/a.ts', base(root, facts({ files: ['src/a.ts'] }), async (req) => {
        const user = userText(req)
        seen.push(user)
        thinking.push(req.thinking === true)
        assert.equal(user.includes('Kind: plan'), false)
        edits += 1
        return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 2' }] }) }
      }, async () => {
        if (edits < 3) return { ok: false, output: 'BOOM line 3' }
        return { ok: true, output: 'ok' }
      }))
    assert.equal(result.kind, 'edit')
    assert.equal(result.stopped, 'finish')
    assert.equal(result.attempts[0]?.tries, 3)
    assert.equal(result.attempts[0]?.candidates, 0)
    assert.equal(thinking[0], false)
    assert.equal(thinking[1], true)
    assert.ok(seen[2]?.includes('BOOM line 3'))
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 2\n')
    assert.match(result.answer, /Undo restores/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('best-of-N keeps the candidate that passes after the retries miss', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }))
  let checks = 0
  try {
    const result = await runSplitTask('Fix the typo in src/a.ts', base(root, facts({ files: ['src/a.ts'] }), async (req) => {
      const user = userText(req)
      const good = user.includes('Candidate: 2')
      const text = good ? 'export const n = 2' : 'export const n = 9'
      return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: text }] }) }
    }, async () => {
      checks += 1
      const file = readFileSync(join(root, 'src/a.ts'), 'utf8')
      if (file.includes('export const n = 2')) return { ok: true, output: 'ok' }
      return { ok: false, output: 'BOOM still wrong' }
    }))
    assert.equal(result.attempts[0]?.tries, 3)
    assert.equal(result.attempts[0]?.candidates, 2)
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 2\n')
    assert.ok(checks >= 5)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a failed step is replanned with its dependents, and a dead end names a larger model', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  const index = facts({
    files: ['src/a.ts', 'src/b.ts'],
    edges: [{ from: 'src/b.ts', to: 'src/a.ts', kind: 'imports' }],
  })
  const catalog = [
    { id: 'qwen3.5-2b-q6_k', family: 'qwen3.5', paramsB: 2, sizeBytes: 1_574_961_408, minRamGb: 4, agents: ['code'], defaultFor: ['code'], sizeName: '2B' },
    { id: 'qwen3.5-4b-q6_k', family: 'qwen3.5', paramsB: 4, sizeBytes: 3_525_956_768, minRamGb: 16, agents: ['code'], sizeName: '4B' },
  ]
  try {
    const repaired = await runSplitTask('Refactor the constant in src/a.ts and src/b.ts', {
      ...base(root, index, async (req) => {
        const user = userText(req)
        if (user.includes('Kind: replan')) {
          return { content: JSON.stringify({ steps: [planStep('fix2', 'apply the fix', 'src/a.ts')] }) }
        }
        if (user.includes('Kind: plan')) {
          return { content: JSON.stringify({ steps: [planStep('s1', 'change the constant', 'src/a.ts'), planStep('s2', 'update the caller', 'src/b.ts', ['s1'])] }) }
        }
        if (user.includes('apply the fix')) {
          return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'export const n = 1', new: 'export const n = 4' }] }) }
        }
        return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'missing', new: 'nope' }] }) }
      }, async () => {
        const file = readFileSync(join(root, 'src/a.ts'), 'utf8')
        return file.includes('export const n = 4') ? { ok: true, output: 'ok' } : { ok: false, output: 'BOOM missing 4' }
      }),
      totalRamGb: 16,
      currentModelId: 'qwen3.5-2b-q6_k',
      catalog,
    })
    assert.equal(repaired.kind, 'plan')
    assert.equal(repaired.stopped, 'finish')
    assert.equal(repaired.attempts.some((item) => item.replanned), true)
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 4\n')
    assert.equal(repaired.suggestion, null)

    writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
    const stuck = await runSplitTask('Refactor the constant in src/a.ts and src/b.ts', {
      ...base(root, index, async (req) => {
        const user = userText(req)
        if (user.includes('Kind: replan')) return { content: 'not json' }
        if (user.includes('Kind: plan')) return { content: JSON.stringify({ steps: [planStep('s1', 'change the constant', 'src/a.ts')] }) }
        return { content: JSON.stringify({ edits: [{ path: 'src/a.ts', old: 'missing', new: 'nope' }] }) }
      }, async () => ({ ok: false, output: 'BOOM' })),
      totalRamGb: 16,
      currentModelId: 'qwen3.5-2b-q6_k',
      catalog,
    })
    assert.equal(stuck.stopped, 'failed')
    assert.equal(stuck.suggestion?.id, 'qwen3.5-4b-q6_k')
    assert.match(stuck.answer, /Nothing is downloaded automatically/)
    assert.equal(readFileSync(join(root, 'src/a.ts'), 'utf8'), 'export const n = 1\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the checklist renders before the run and undo is offered after', () => {
  const messageId = '11111111-1111-4111-8111-111111111111'
  const html = renderToStaticMarkup(createElement(CodeTrace, {
    messageId,
    steps: [],
    diffs: [],
    plan: {
      status: 'review',
      steps: [
        { id: 'def', index: 1, goal: 'Update the definition', files: ['src/util.ts'], symbols: ['formatName'], dependsOn: [], check: 'test: npm test', create: false },
        { id: 'call', index: 2, goal: 'Update the caller', files: ['src/app.ts'], symbols: [], dependsOn: ['def'], check: 'test: npm test', create: false },
      ],
    },
    onRevise: () => undefined,
  }))
  assert.match(html, /data-code-plan="review"/)
  assert.match(html, /data-code-plan-run="yes"/)
  assert.match(html, /data-code-plan-up="call"/)
  assert.match(html, /data-code-plan-remove="def"/)
  assert.match(html, /src\/util\.ts/)

  const prev: UiMsg[] = [{ id: 'pending', role: 'assistant', text: '', sources: [], tools: [], pending: true }]
  const withPlan = applyEvent(prev, {
    type: 'code-plan',
    messageId,
    plan: { status: 'done', steps: [{ id: 'def', index: 1, goal: 'Update the definition', files: ['src/util.ts'], symbols: [], dependsOn: [], check: 'test: npm test', create: false }], undos: [{ stepId: 'def', title: 'Update the definition' }] },
  })
  assert.equal(withPlan[0]?.plan?.status, 'done')
  assert.equal(withPlan[0]?.plan?.undos?.[0]?.stepId, 'def')
})

function planStep(id: string, goal: string, file: string, depends: string[] = []) {
  return { id, goal, files: [file], symbols: [], depends_on: depends, check: { kind: 'test', command: 'npm test' }, create: false }
}

function userText(req: CompletionRequest): string {
  const last = req.messages.at(-1)?.content
  return typeof last === 'string' ? last : ''
}

function base(
  root: string,
  project: PlanFacts,
  complete: (req: CompletionRequest) => Promise<ModelTurn>,
  runCommand: (command: string) => Promise<{ ok: boolean; output: string }>,
): SplitHost {
  return {
    root,
    facts: project,
    rules: 'Follow the project style.',
    counter: heuristicCounter,
    promptBudget: 2000,
    searchBudget: 400,
    answerTokens: 400,
    mode: 'ask',
    search: { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } },
    complete,
    async ask() { return { allow: true } },
    runCommand,
  }
}
