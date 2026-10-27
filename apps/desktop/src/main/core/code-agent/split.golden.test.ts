/**
 * Golden snapshot tests for runSplitTask (the step-4 orchestrator).
 *
 * These pin the SplitResult shape (ordered views, diffs, plan, answer, kind, stop
 * reason, per-step attempts) byte-for-byte, so relocating split.ts into
 * @surf/agent-core is provably behavior-preserving. checkpoints are intentionally
 * excluded because they carry the absolute workspace path.
 *
 * Run `UPDATE_SNAPSHOTS=1` to regenerate the committed .snap fixtures.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { runSplitTask, type SplitHost } from './split.js'
import type { CompletionRequest } from './loop.js'
import type { ModelTurn } from './parse-tool.js'
import type { PlanFacts } from './plan.js'
import { heuristicCounter } from '../token-budget.js'

const snapshotDir = join(fileURLToPath(new URL('.', import.meta.url)), '__snapshots__')

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

function project(): { root: string; dispose(): void } {
  const base = join(fileURLToPath(new URL('.', import.meta.url)), '../../../../.golden-tmp')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'split-'))
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function facts(files: string[]): PlanFacts {
  return { indexed: true, files, symbols: [], edges: [] }
}

function emptySearch() {
  return { async context() { return { snippets: [], files: [], tokens: 0, dropped: 0 } } }
}

test('golden: a chat task delegates to the loop through runSplitTask', async () => {
  const p = project()
  try {
    const host: SplitHost = {
      root: p.root,
      facts: facts([]),
      rules: 'Follow the project style.',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 400,
      answerTokens: 400,
      mode: 'ask',
      search: emptySearch(),
      async complete(): Promise<ModelTurn> {
        return { content: '{"tool":"finish","arguments":{"summary":"This file describes the project."}}' }
      },
      async ask() {
        return { allow: true }
      },
    }
    const result = await runSplitTask('What does this README describe?', host)
    matchSnapshot('split-chat', canonical({
      kind: result.kind,
      answer: result.answer,
      stopped: result.stopped,
      steps: result.steps,
      diffs: result.diffs,
      plan: result.plan,
    }))
  } finally {
    p.dispose()
  }
})

test('golden: a two-file edit task plans, edits both files, and passes its check', async () => {
  const p = project()
  try {
    mkdirSync(join(p.root, 'src'), { recursive: true })
    writeFileSync(join(p.root, 'src', 'a.ts'), 'export const n = 1\n')
    writeFileSync(join(p.root, 'src', 'b.ts'), 'export const m = 1\n')

    const requests: CompletionRequest[] = []
    const host: SplitHost = {
      root: p.root,
      facts: facts(['src/a.ts', 'src/b.ts']),
      rules: 'Follow the project style.',
      counter: heuristicCounter,
      promptBudget: 2000,
      searchBudget: 400,
      answerTokens: 400,
      mode: 'ask',
      search: emptySearch(),
      async complete(req): Promise<ModelTurn> {
        requests.push(req)
        const user = String(req.messages.at(-1)?.content ?? '')
        if (user.includes('Kind: plan')) {
          return {
            content: JSON.stringify({
              steps: [
                { id: 's1', goal: 'bump n', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'typecheck', command: '' }, create: false },
                { id: 's2', goal: 'bump m', files: ['src/b.ts'], symbols: [], depends_on: ['s1'], check: { kind: 'typecheck', command: '' }, create: false },
              ],
            }),
          }
        }
        if (user.includes('src/b.ts')) {
          return { content: '{"edits":[{"path":"src/b.ts","old":"export const m = 1","new":"export const m = 2"}]}' }
        }
        return { content: '{"edits":[{"path":"src/a.ts","old":"export const n = 1","new":"export const n = 2"}]}' }
      },
      async ask() {
        return { allow: true }
      },
    }
    const result = await runSplitTask('Update src/a.ts and src/b.ts to bump the constants, and leave package.json alone', host)
    matchSnapshot('split-edit', canonical({
      kind: result.kind,
      answer: result.answer,
      stopped: result.stopped,
      steps: result.steps,
      diffs: result.diffs,
      plan: result.plan,
      attempts: result.attempts,
      requestKinds: requests.map((req) => req.stepKind ?? 'n/a'),
    }))
  } finally {
    p.dispose()
  }
})
