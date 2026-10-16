/**
 * Scripted multi-step code-agent tasks. Prints measurements. Python scores them.
 * No live model and no download.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CompletionRequest } from './code-agent/loop.js'
import type { ModelTurn } from './code-agent/parse-tool.js'
import type { PlanFacts } from './code-agent/plan.js'
import { runSplitTask, type SplitHost } from './code-agent/split.js'
import { heuristicCounter } from './token-budget.js'

interface Measurement {
  id: string
  weight: number
  fields: Record<string, unknown>
}

const CATALOG = [
  { id: 'qwen3.5-2b-q6_k', family: 'qwen3.5', paramsB: 2, sizeBytes: 1_574_961_408, minRamGb: 4, agents: ['code'], defaultFor: ['code'], sizeName: '2B' },
  { id: 'qwen3.5-4b-q6_k', family: 'qwen3.5', paramsB: 4, sizeBytes: 3_525_956_768, minRamGb: 16, agents: ['code'], sizeName: '4B' },
]

function userText(req: CompletionRequest): string {
  const last = req.messages.at(-1)?.content
  return typeof last === 'string' ? last : ''
}

function host(
  root: string,
  facts: PlanFacts,
  complete: (req: CompletionRequest) => Promise<ModelTurn>,
  runCommand: (command: string) => Promise<{ ok: boolean; output: string }>,
): SplitHost {
  return {
    root,
    facts,
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

function edit(path: string, old: string, next: string): ModelTurn {
  return { content: JSON.stringify({ edits: [{ path, old, new: next }] }) }
}

async function splitOrder(): Promise<Measurement> {
  const root = mkdtempSync(join(tmpdir(), 'surf-split-order-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/util.ts'), 'export function formatName(value: string): string {\n  return value\n}\n')
  writeFileSync(join(root, 'src/app.ts'), 'import { formatName } from \'./util\'\nexport function greet(name: string): string {\n  return formatName(name)\n}\n')
  writeFileSync(join(root, 'src/app.test.ts'), 'import { greet } from \'./app\'\nexport function testGreet(): string {\n  return greet(\'a\')\n}\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  const facts: PlanFacts = {
    indexed: true,
    files: ['src/util.ts', 'src/app.ts', 'src/app.test.ts'],
    symbols: [{ name: 'formatName', qualified: 'formatName', kind: 'function', path: 'src/util.ts' }],
    edges: [{ from: 'src/app.ts', to: 'src/util.ts', kind: 'imports' }],
  }
  const writes: string[] = []
  let order: string[] = []
  let reviewedBeforeWrite = false
  try {
    const result = await runSplitTask('Refactor formatName in src/util.ts and src/app.ts then update the tests', {
      ...host(root, facts, async (req) => {
        const user = userText(req)
        if (user.includes('Kind: plan')) {
          return {
            content: JSON.stringify({
              steps: [
                { id: 'call', goal: 'Update the caller', files: ['src/app.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false },
                { id: 'def', goal: 'Update the definition', files: ['src/util.ts'], symbols: ['formatName'], depends_on: ['call'], check: { kind: 'test', command: 'npm test' }, create: false },
                { id: 'spec', goal: 'Update the tests', files: ['src/app.test.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false },
              ],
            }),
          }
        }
        if (user.includes('Update the definition')) {
          writes.push('def')
          return edit('src/util.ts', 'return value', 'return value.trim()')
        }
        if (user.includes('Update the caller')) {
          writes.push('call')
          return edit('src/app.ts', 'return formatName(name)', 'return formatName(name.trim())')
        }
        writes.push('spec')
        return edit('src/app.test.ts', "return greet('a')", "return greet(' a ')")
      }, async () => ({ ok: true, output: 'ok' })),
      reviewPlan: async (steps) => {
        reviewedBeforeWrite = writes.length === 0
        order = steps.map((step) => step.id)
        return order
      },
    })
    return {
      id: 'split-order',
      weight: 1,
      fields: { order, writes, stopped: result.stopped, reviewedBeforeWrite, steps: result.plan?.steps.length ?? 0 },
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function splitRetry(): Promise<Measurement> {
  const root = mkdtempSync(join(tmpdir(), 'surf-split-retry-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }))
  let checks = 0
  let plannerCalls = 0
  try {
    const result = await runSplitTask('Fix the typo in src/a.ts', host(root, { indexed: true, files: ['src/a.ts'], symbols: [], edges: [] }, async (req) => {
      const user = userText(req)
      if (user.includes('Kind: plan') || user.includes('Kind: replan')) plannerCalls += 1
      return edit('src/a.ts', 'export const n = 1', 'export const n = 2')
    }, async () => {
      checks += 1
      if (checks < 3) return { ok: false, output: 'BOOM line 3' }
      return { ok: true, output: 'ok' }
    }))
    return {
      id: 'split-retry',
      weight: 1,
      fields: {
        tries: result.attempts[0]?.tries ?? 0,
        plannerCalls,
        fixed: readFileSync(join(root, 'src/a.ts'), 'utf8').includes('export const n = 2'),
        kind: result.kind,
      },
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function splitReplan(): Promise<Measurement> {
  const root = mkdtempSync(join(tmpdir(), 'surf-split-replan-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'src/b.ts'), 'import { n } from \'./a\'\nexport const used = n\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  const facts: PlanFacts = {
    indexed: true,
    files: ['src/a.ts', 'src/b.ts'],
    symbols: [],
    edges: [{ from: 'src/b.ts', to: 'src/a.ts', kind: 'imports' }],
  }
  try {
    const result = await runSplitTask('Refactor the constant in src/a.ts and src/b.ts', {
      ...host(root, facts, async (req) => {
        const user = userText(req)
        if (user.includes('Kind: replan')) {
          return { content: JSON.stringify({ steps: [{ id: 'fix2', goal: 'apply the fix', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false }] }) }
        }
        if (user.includes('Kind: plan')) {
          return {
            content: JSON.stringify({
              steps: [
                { id: 's1', goal: 'change the constant', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false },
                { id: 's2', goal: 'update the caller', files: ['src/b.ts'], symbols: [], depends_on: ['s1'], check: { kind: 'test', command: 'npm test' }, create: false },
              ],
            }),
          }
        }
        if (user.includes('apply the fix')) return edit('src/a.ts', 'export const n = 1', 'export const n = 4')
        return edit('src/a.ts', 'missing', 'nope')
      }, async () => {
        const file = readFileSync(join(root, 'src/a.ts'), 'utf8')
        return file.includes('export const n = 4') ? { ok: true, output: 'ok' } : { ok: false, output: 'BOOM missing 4' }
      }),
      reviewPlan: async (steps) => steps.map((step) => step.id),
    })
    const value = readFileSync(join(root, 'src/a.ts'), 'utf8').includes('export const n = 4') ? 4 : 0
    return {
      id: 'split-replan',
      weight: 1,
      fields: { replanned: result.attempts.some((item) => item.replanned), stopped: result.stopped, value },
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function splitSuggest(): Promise<Measurement> {
  const root = mkdtempSync(join(tmpdir(), 'surf-split-suggest-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src/a.ts'), 'export const n = 1\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  let downloads = 0
  try {
    const result = await runSplitTask('Refactor the constant in src/a.ts and src/b.ts', {
      ...host(root, { indexed: true, files: ['src/a.ts', 'src/b.ts'], symbols: [], edges: [] }, async (req) => {
        const user = userText(req)
        if (user.includes('Kind: replan')) return { content: 'not json' }
        if (user.includes('Kind: plan')) {
          return { content: JSON.stringify({ steps: [{ id: 's1', goal: 'change the constant', files: ['src/a.ts'], symbols: [], depends_on: [], check: { kind: 'test', command: 'npm test' }, create: false }] }) }
        }
        return edit('src/a.ts', 'missing', 'nope')
      }, async () => ({ ok: false, output: 'BOOM' })),
      totalRamGb: 16,
      currentModelId: 'qwen3.5-2b-q6_k',
      catalog: CATALOG,
      reviewPlan: async (steps) => steps.map((step) => step.id),
    })
    return {
      id: 'split-suggest',
      weight: 1,
      fields: {
        suggestion: result.suggestion?.id ?? '',
        downloaded: downloads > 0,
        unchanged: readFileSync(join(root, 'src/a.ts'), 'utf8') === 'export const n = 1\n',
        stopped: result.stopped,
        mentionsDownload: result.answer.includes('Nothing is downloaded automatically'),
      },
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function measure(): Promise<Measurement[]> {
  return [await splitOrder(), await splitRetry(), await splitReplan(), await splitSuggest()]
}

const main = process.argv[1] && /code-split-suite/.test(process.argv[1])
if (main) {
  measure().then((rows) => {
    process.stdout.write(JSON.stringify(rows))
  }).catch((error: unknown) => {
    console.error(error)
    process.exit(1)
  })
}
