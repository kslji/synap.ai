/**
 * Ask llama-server the Step 11 questions and write accuracy, speed, and RSS.
 * Prompt text stays out of the report. The report keeps ids, labels, and timings.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { LlamaClient } from '../src/main/core/llama-client.ts'
import {
  coverSkips,
  evalContextTokens,
  choiceLabels,
  labelGrammar,
  loadThresholds,
  mmprojRamAllows,
  modelEvalPrompt,
  passesThresholds,
  ramAllows,
  releaseGate,
  scoreModelLabel,
  selectModelEvalQuestions,
  summarizeAnswers,
  tokenizerUrl,
  type MeasuredModel,
  type ModelAnswerRow,
  type MmprojMeasure,
} from '../src/main/core/model-eval.ts'
import { evalQuestions } from '../src/main/core/step11-questions.ts'
import { LlamaServer } from '../src/main/core/sidecar-manager.ts'
import { ensureModel, registryEntries } from './model-weights.mjs'
import { availableRamGb, watchRss } from './rss.ts'

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..')
const repo = join(desktop, '..', '..')
const questions = evalQuestions()

function option(name: string): string | undefined {
  const eq = process.argv.find((item) => item.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  const next = index >= 0 ? process.argv[index + 1] : undefined
  return next && !next.startsWith('--') ? next : undefined
}

const flag = (name: string) => process.argv.includes(`--${name}`)

function serverBin(): string {
  const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
  return join(desktop, 'resources', 'bin', `${process.platform}-${process.arch}`, exe)
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function thresholds() {
  return loadThresholds(readJson(join(repo, 'harness', 'baselines', 'model-eval.json')))
}

async function tokenizerReady(server: LlamaServer, weightsUrl: string, dir: string): Promise<'gguf' | 'tokenizer.json'> {
  const response = await fetch(`${server.baseUrl}/tokenize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${server.apiKey}` },
    body: JSON.stringify({ content: 'surf' }),
  })
  if (response.ok) {
    const body = await response.json() as { tokens?: unknown[] }
    if (Array.isArray(body.tokens) && body.tokens.length > 0) return 'gguf'
  }
  const fetched = await fetch(tokenizerUrl(weightsUrl), { redirect: 'follow', headers: { 'User-Agent': 'synap-model-eval' } })
  if (!fetched.ok) throw new Error('tokenizer.json was not available and /tokenize failed')
  const text = await fetched.text()
  if (!text.startsWith('{') || text.length < 1000) throw new Error('tokenizer.json was not a tokenizer file')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'tokenizer.json'), text)
  return 'tokenizer.json'
}

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function ask(server: LlamaServer, prompt: string, grammar: string | undefined, image: boolean): Promise<{ text: string; ttftMs: number | null; tokens: number; genMs: number }> {
  const client = new LlamaClient({
    baseUrl: server.baseUrl,
    apiKey: server.apiKey,
    sampling: { temperature: 0, top_p: 1, top_k: 1, presence_penalty: 0 },
    chatTemplateKwargs: { enable_thinking: false },
  })
  const started = performance.now()
  let first: number | null = null
  const content = image
    ? [{ type: 'text' as const, text: prompt }, { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${TINY_PNG}` } }]
    : prompt
  const result = await client.chatCollect(
    [{ role: 'user', content }],
    undefined,
    undefined,
    image ? 24 : 8,
    grammar ? { grammar } : undefined,
    (piece) => { if (first == null && piece) first = performance.now() },
  )
  const ended = performance.now()
  const text = result.choices[0]?.message.content
  const reply = typeof text === 'string' ? text : ''
  const tokens = result.usage?.completion_tokens ?? (reply ? 1 : 0)
  return {
    text: reply,
    ttftMs: first == null ? null : Math.round(first - started),
    tokens,
    genMs: Math.max(1, Math.round(ended - (first ?? started))),
  }
}

async function runQuestions(server: LlamaServer, mode: 'subset' | 'full'): Promise<ModelAnswerRow[]> {
  const limit = Number(option('limit') ?? 0)
  const picked = selectModelEvalQuestions(mode, questions).slice(0, limit > 0 ? limit : undefined)
  const rows: ModelAnswerRow[] = []
  for (const question of picked) {
    const labels = choiceLabels(question, questions)
    const answer = await ask(server, modelEvalPrompt(question, labels), labelGrammar(labels), false)
    const scored = scoreModelLabel(answer.text, question.expect, labels)
    rows.push({
      id: question.id,
      domain: question.domain,
      ok: scored.ok,
      label: scored.label,
      ttftMs: answer.ttftMs,
      tokens: answer.tokens,
      genMs: answer.genMs,
    })
    process.stdout.write(`${question.id} ${scored.ok ? 'ok' : 'miss'}\n`)
  }
  return rows
}

async function withServer(modelPath: string, ctx: number, mmprojPath: string | undefined, body: (server: LlamaServer, peak: () => number) => Promise<void>): Promise<number> {
  const server = new LlamaServer({
    binPath: serverBin(),
    modelPath,
    mmprojPath,
    ctx,
    threads: Math.min(8, availableParallelism()),
    gpuLayers: process.platform === 'darwin' ? 'auto' : 0,
    startupTimeoutMs: ctx > 8192 ? 300_000 : 180_000,
  })
  const watch = watchRss(() => server.pid)
  try {
    await server.start()
    await body(server, watch.peak)
    return watch.stop()
  } finally {
    watch.stop()
    await server.stop()
  }
}

async function visionProbe(modelPath: string, ctx: number, mmprojPath: string, sha256: string): Promise<MmprojMeasure> {
  try {
    let replied = false
    let peak = 0
    peak = await withServer(modelPath, ctx, mmprojPath, async (server, readPeak) => {
      const answer = await ask(server, 'Reply with the single word screen.', undefined, true)
      replied = answer.text.trim().length > 0
      peak = readPeak()
    })
    return { measured: true, sha256, peakRssMb: Math.round(peak * 10) / 10, replied }
  } catch (error) {
    return {
      measured: false,
      sha256,
      peakRssMb: null,
      replied: false,
      reason: error instanceof Error ? error.message.slice(0, 180) : 'mmproj-failed',
    }
  }
}

function blank(id: string, sha256: string, reason: string): MeasuredModel {
  return {
    id, sha256, measured: false, reason,
    accuracy: null, noFabrication: null, tokensPerSec: null, ttftMs: null, peakRssMb: null, questions: 0,
  }
}

async function main(): Promise<void> {
  const gatePath = option('gate')
  const limits = thresholds()
  if (gatePath) {
    const report = readJson(gatePath) as { models?: MeasuredModel[] }
    const baselinePath = option('baseline') ?? join(repo, 'harness', 'baselines', 'model-eval-full.json')
    const saved = existsSync(baselinePath) ? (readJson(baselinePath) as { models?: MeasuredModel[] }).models ?? [] : []
    const judged = releaseGate(coverSkips(report.models ?? [], saved), limits)
    for (const reason of judged.reasons) process.stderr.write(`${reason}\n`)
    if (!judged.ok) process.exit(1)
    process.stdout.write('model-eval-full release gate passed\n')
    return
  }

  if (!existsSync(serverBin())) throw new Error('llama-server is not installed. Run node apps/desktop/scripts/fetch-sidecars.mjs')
  const mode = option('mode') === 'full' ? 'full' : 'subset'
  const ids = (option('models') ?? 'qwen3.5-2b-q4_k_m').split(',').map((item) => item.trim()).filter(Boolean)
  const dir = option('dir') ?? process.env.SURF_MODELS_DIR ?? join(repo, '.surf-models')
  const allowSkip = flag('allow-skip')
  const wantVision = flag('mmproj')
  const free = availableRamGb()
  const models: MeasuredModel[] = []
  let failed = false

  for (const id of ids) {
    const weights = registryEntries([id]).find((row) => row.kind === 'weights')
    if (!weights) throw new Error(`missing registry row ${id}`)
    if (!ramAllows(free, weights.minRamGb)) {
      const row = blank(id, weights.sha256, 'insufficient-ram')
      models.push(row)
      process.stderr.write(`${id} skipped: ${free?.toFixed(1) ?? 'unknown'} GB available, needs ${weights.minRamGb} GB\n`)
      if (!allowSkip) failed = true
      continue
    }
    const saved = await ensureModel(weights, dir)
    let tokenizer: 'gguf' | 'tokenizer.json' = 'gguf'
    const rows = { current: [] as ModelAnswerRow[] }
    let peak = 0
    try {
      peak = await withServer(saved.path, evalContextTokens(weights.minRamGb), undefined, async (server) => {
        tokenizer = await tokenizerReady(server, weights.url, dir)
        rows.current = await runQuestions(server, mode)
      })
    } catch (error) {
      models.push(blank(id, weights.sha256, error instanceof Error ? error.message.slice(0, 180) : 'run-failed'))
      failed = true
      continue
    }
    const summary = summarizeAnswers(rows.current)
    const judged = passesThresholds(summary.accuracy, summary.noFabrication.accuracy, limits)
    let mmproj: MmprojMeasure | undefined
    if (wantVision) {
      const vision = registryEntries([id], { mmproj: true }).find((row) => row.kind === 'mmproj')
      if (vision && mmprojRamAllows(availableRamGb(), weights.minRamGb, vision.sizeBytes)) {
        const visionFile = await ensureModel(vision, dir)
        mmproj = await visionProbe(saved.path, evalContextTokens(weights.minRamGb), visionFile.path, vision.sha256)
        if (!mmproj.measured || !mmproj.replied) {
          if (!allowSkip) failed = true
        }
      } else if (vision) {
        mmproj = { measured: false, sha256: vision.sha256, peakRssMb: null, replied: false, reason: 'insufficient-ram' }
        if (!allowSkip) failed = true
      }
    }
    models.push({
      id,
      sha256: weights.sha256,
      measured: true,
      accuracy: summary.accuracy,
      noFabrication: summary.noFabrication.accuracy,
      tokensPerSec: summary.tokensPerSec,
      ttftMs: summary.ttftMs,
      peakRssMb: Math.round(peak * 10) / 10,
      questions: summary.questions,
      tokenizer,
      mmproj,
    })
    process.stdout.write(`${id} accuracy=${summary.accuracy.toFixed(3)} no-fabrication=${summary.noFabrication.accuracy.toFixed(3)} tok/s=${summary.tokensPerSec?.toFixed(2) ?? 'n/a'} ttft=${summary.ttftMs ?? 'n/a'} rss=${Math.round(peak)} tokenizer=${tokenizer} ${judged.ok ? 'pass' : 'fail'}\n`)
    if (!judged.ok) failed = true
    const detailPath = join(repo, 'harness', 'reports', `${id}.rows.json`)
    mkdirSync(dirname(detailPath), { recursive: true })
    writeFileSync(detailPath, `${JSON.stringify(rows.current, null, 2)}\n`)
  }

  const report = {
    mode,
    generatedAt: new Date().toISOString(),
    host: { platform: process.platform, arch: process.arch, availableRamGb: free },
    thresholds: limits,
    models,
    passed: !failed,
  }
  const out = option('out') ?? join(repo, 'harness', 'reports', mode === 'full' ? 'model-eval-full.json' : 'model-eval.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`wrote ${out}\n`)
  if (failed) process.exit(1)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
