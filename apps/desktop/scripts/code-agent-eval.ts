/**
 * The 20-task agent eval, on the real local model, with and without task decomposition.
 *
 * Direct: `runCodeAgent` - one loop, no triage, no plan.
 * Split:  `runSplitTask` - triage, plan, per-step checks, and the failure ladder.
 *
 * Each task runs on the same throwaway project in a temp folder, and both modes are scored the
 * same way: the listed files must end in the expected state and the run must stop on finish.
 * The folder also gets a real `npm run typecheck` (the repo's own TypeScript), so a step check can
 * fail, roll back, and go round the fix loop instead of trusting the model.
 * The tasks and the scoring live in src/main/core/code-agent/eval-cases.ts, where a unit test
 * checks them without a model. Only pass rates and timings are reported; prompt and answer text
 * stay in the temp folder.
 *
 * Usage (from the repo root, or with `npm run eval:agent`):
 *   tsx apps/desktop/scripts/code-agent-eval.ts            # all 20 tasks, both modes, 2B default
 *   tsx apps/desktop/scripts/code-agent-eval.ts --only rename-add,max-bytes
 *   tsx apps/desktop/scripts/code-agent-eval.ts --mode direct --json /tmp/agent-eval.json
 *   tsx apps/desktop/scripts/code-agent-eval.ts --model-file ~/models/Qwen3.5-4B-Q4_K_M.gguf
 */
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir, platform, arch, availableParallelism } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { EVAL_SAMPLING, LlamaClient } from '../src/main/core/llama-client.js'
import { LlamaServer } from '../src/main/core/sidecar-manager.js'
import { LocalLlamaProvider } from '../src/main/core/code-agent/llama.js'
import { runCodeAgent } from '../src/main/core/code-agent/loop.js'
import { runSplitTask, type SplitHost } from '../src/main/core/code-agent/split.js'
import { createProjectSearch } from '../src/main/core/code-agent/project-search.js'
import type { PlanFacts } from '../src/main/core/code-agent/plan.js'
import { AGENT_EVAL_CASES, EVAL_RULES, scoreFiles, type EvalCase } from '../src/main/core/code-agent/eval-cases.js'
import { evalProjectFiles, evalTestCommand } from '../src/main/core/code-agent/eval-project.js'
import { runProjectCommand } from '../src/main/core/code-agent/workspace.js'
import { heuristicCounter } from '../src/main/core/token-budget.js'
import { providerToComplete, type CompletionRequest, type ModelTurn } from '@surf/agent-core'

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..')
/** The repo's own TypeScript, so a fixture can typecheck without installing anything. */
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc')
/** The repo's own tsx, so `npm test` runs a fixture's TypeScript test with no build step. */
const TSX = createRequire(import.meta.url).resolve('tsx')
/** What the loop runs before it accepts a finish: the compiler, then the fixture's own test. */
const VERIFY = ['npm run typecheck', 'npm test']

type Mode = 'direct' | 'split'

interface Outcome {
  id: string
  mode: Mode
  pass: boolean
  stopped: string
  steps: number
  requests: number
  ms: number
  why: string
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return undefined
  const next = process.argv[index + 1]
  return next && !next.startsWith('--') ? next : undefined
}

const flag = (name: string): boolean => process.argv.includes(`--${name}`)

function writeFixture(root: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
}

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** What the run left behind, read back into the shape `scoreFiles` scores. */
function finishedTexts(root: string, c: EvalCase): Record<string, string | null> {
  const texts: Record<string, string | null> = {}
  for (const rule of c.check) texts[rule.path] = readIfExists(join(root, rule.path))
  return texts
}

async function runCase(
  c: EvalCase,
  mode: Mode,
  complete: (req: CompletionRequest) => Promise<ModelTurn>,
  timeoutMs: number,
  verbose = false,
): Promise<Outcome> {
  // macOS gives a /var path that resolves to /private/var; the sandbox compares real paths.
  const root = mkdtempSync(join(realpathSync(tmpdir()), `surf-agent-eval-${c.id}-`))
  writeFixture(root, c.files)
  // A real check: without one the ladder cannot tell a bad edit from a good one, and a skipped
  // second file still scores as a pass.
  writeFixture(root, c.tests)
  writeFixture(root, evalProjectFiles(TSC, { test: evalTestCommand(TSX, Object.keys(c.tests)) }))
  const facts: PlanFacts = { indexed: false, files: Object.keys(c.files), symbols: [], edges: [] }
  let requests = 0
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  let stopped = ''
  let steps = 0
  try {
    const host: SplitHost = {
      root,
      facts,
      rules: EVAL_RULES,
      counter: heuristicCounter,
      promptBudget: 2600,
      searchBudget: 600,
      answerTokens: 512,
      mode: 'ask',
      limits: { maxSteps: 8 },
      signal: controller.signal,
      search: createProjectSearch(root, { runner: 'substring' }),
      // Only a verbose run prints what the model tried; a silent run only prints the score.
      onStep: verbose ? (step) => console.log(`  ${c.id}/${mode} ${step.tool} ${step.status}${step.detail ? `: ${step.detail.slice(0, 160)}` : ''}`) : undefined,
      onDiff: verbose ? (diff) => console.log(`  ${c.id}/${mode} diff ${diff.path} ${diff.status}`) : undefined,
      complete: (req) => { requests += 1; return complete(req) },
      // The eval scores the code a task ends with, so approvals never block a run.
      ask: async () => ({ allow: true }),
      runCommand: (command, signal, hooks) => runProjectCommand(root, command, signal, hooks),
      // The loop verifies a finished edit itself; this is the same pair of commands.
      verify: VERIFY,
    }
    if (mode === 'direct') {
      const result = await runCodeAgent(c.task, host)
      stopped = result.stopped
      steps = result.steps.length
    } else {
      const result = await runSplitTask(c.task, host)
      stopped = result.stopped
      steps = result.steps.length
    }
  } catch (error) {
    stopped = controller.signal.aborted ? 'timeout' : 'error'
    void error
  } finally {
    clearTimeout(timer)
  }
  const texts = finishedTexts(root, c)
  const scored = scoreFiles(texts, c)
  // The behavioural test is scored here too, independently of whatever the run claimed: a file
  // that reads right but behaves wrong is not a pass.
  const behaviour = await runProjectCommand(root, 'npm test')
  const why = scored.pass
    ? (behaviour.ok ? (stopped === 'finish' ? '' : `stopped: ${stopped}`) : `fixture test failed\n${behaviour.output.slice(-800)}`)
    : scored.why
  // A verbose failure prints what the files ended as, which is the only way to tell a bad edit
  // from a bad score.
  if (verbose && !scored.pass) {
    for (const [path, text] of Object.entries(texts)) console.log(`  ${c.id}/${mode} ${path}:\n${text ?? '(missing)'}`)
  }
  rmSync(root, { recursive: true, force: true })
  return {
    id: c.id,
    mode,
    pass: scored.pass && stopped === 'finish' && behaviour.ok,
    stopped,
    steps,
    requests,
    ms: Date.now() - started,
    why,
  }
}

function defaultModelsDir(): string {
  if (process.env.SURF_MODELS_DIR) return process.env.SURF_MODELS_DIR
  const app = 'Synap.surf'
  if (platform() === 'darwin') return join(process.env.HOME ?? '', 'Library', 'Application Support', app, 'models')
  if (platform() === 'win32') return join(process.env.APPDATA ?? '', app, 'models')
  return join(process.env.HOME ?? '', '.config', app, 'models')
}

interface RegistryRow {
  id: string
  file: string
  size_bytes: number
  tiers?: number[]
  default_for?: string[]
  chat_template_kwargs?: Record<string, unknown>
}

function registryRows(): RegistryRow[] {
  const parsed = JSON.parse(readFileSync(join(DESKTOP, 'resources', 'models.registry.json'), 'utf8')) as { models?: RegistryRow[] } | RegistryRow[]
  return Array.isArray(parsed) ? parsed : (parsed.models ?? [])
}

async function main(): Promise<number> {
  const modelsDir = option('models-dir') ?? defaultModelsDir()
  const only = option('only')?.split(',').map((id) => id.trim()).filter(Boolean)
  const chosenMode = option('mode')
  const jsonPath = option('json')
  const timeoutMs = Math.max(10_000, Number(option('timeout') ?? 120) * 1000)
  const cases = only ? AGENT_EVAL_CASES.filter((c) => only.includes(c.id)) : AGENT_EVAL_CASES
  if (!cases.length) throw new Error(`no task matched --only ${only?.join(',')}`)

  const rows = registryRows()
  const row = option('model')
    ? rows.find((r) => r.id === option('model'))
    : rows.find((r) => r.default_for?.includes('*')) ?? rows[0]
  if (!row) throw new Error('no chat model in the registry')
  const modelPath = option('model-file') ?? (isAbsolute(row.file) ? row.file : join(modelsDir, row.file))
  if (!existsSync(modelPath)) throw new Error(`model weights are not on disk (${modelPath})`)

  const exe = platform() === 'win32' ? 'llama-server.exe' : 'llama-server'
  const binPath = join(DESKTOP, 'resources', 'bin', `${platform()}-${arch()}`, exe)
  if (!existsSync(binPath)) throw new Error(`llama-server is not installed (${binPath})`)

  const server = new LlamaServer({
    binPath,
    modelPath,
    ctx: 8192,
    gpuLayers: 999,
    threads: Math.max(1, availableParallelism() - 1),
    cacheRamMiB: 512,
  })
  console.log(`== Surf agent eval: ${row.id} ==`)
  console.log(`model : ${modelPath} (${(statSync(modelPath).size / 1024 ** 3).toFixed(2)} GiB, ctx 8192)`)
  console.log(`tasks : ${cases.length}, timeout ${timeoutMs / 1000} s per run\n`)

  const modes: Mode[] = chosenMode === 'direct' ? ['direct'] : chosenMode === 'split' ? ['split'] : ['direct', 'split']
  const outcomes: Outcome[] = []
  try {
    await server.start()
    // Deterministic: the eval scores the code a task ends with, not a sample of it.
    const client = new LlamaClient({
      baseUrl: server.baseUrl,
      apiKey: server.apiKey,
      sampling: { ...EVAL_SAMPLING },
      chatTemplateKwargs: row.chat_template_kwargs ?? { enable_thinking: false },
    })
    const complete = providerToComplete(new LocalLlamaProvider(client))
    for (const c of cases) {
      for (const mode of modes) {
        const outcome = await runCase(c, mode, complete, timeoutMs, flag('verbose'))
        outcomes.push(outcome)
        const mark = outcome.pass ? 'PASS' : 'FAIL'
        console.log(`${c.id.padEnd(16)} ${mode.padEnd(6)} ${mark}  ${String(outcome.steps).padStart(2)} steps ${String(outcome.requests).padStart(3)} req ${String(Math.round(outcome.ms / 1000)).padStart(4)} s${outcome.why ? `  ${outcome.why}` : ''}`)
      }
    }
  } finally {
    await server.stop()
  }

  console.log('')
  for (const mode of modes) {
    const rowsOut = outcomes.filter((o) => o.mode === mode)
    const passed = rowsOut.filter((o) => o.pass).length
    const seconds = Math.round(rowsOut.reduce((sum, o) => sum + o.ms, 0) / 1000)
    console.log(`${mode.padEnd(6)}: ${passed}/${rowsOut.length} (${Math.round((passed / rowsOut.length) * 100)}%), ${seconds} s`)
  }
  if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify({ model: row.id, outcomes }, null, 2)}\n`)
  if (flag('strict') && outcomes.some((o) => !o.pass)) return 1
  return 0
}

main().then((code) => { process.exitCode = code }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'agent eval failed')
  process.exitCode = 1
})
