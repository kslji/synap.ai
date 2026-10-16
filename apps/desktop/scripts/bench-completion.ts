/**
 * Latency check for inline completion. Not part of CI.
 *
 * The local section times prompt building, post-processing, and the prefix cache.
 * Set SURF_LLAMA_URL and SURF_LLAMA_KEY to also time llama.cpp /completion on a running server.
 * The p50 target for a 2B model is under 300 ms, measured on that live section.
 *
 *   npm run bench:completion -w @surf/desktop
 */
import { buildCompletionPrompt } from '../src/main/core/code-agent/completion/fim.js'
import { llamaComplete } from '../src/main/core/code-agent/completion/llama-complete.js'
import { finishCompletion } from '../src/main/core/code-agent/completion/post.js'
import { CompletionService, type CompletionHost } from '../src/main/core/code-agent/completion/service.js'
import { predictBudget } from '../src/main/core/code-agent/completion/windows.js'

const rounds = 40

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

function localOnce(): number {
  const started = performance.now()
  const built = buildCompletionPrompt({
    prefix: 'export function harbor() {\n  const name = ',
    suffix: '\n}\n',
    path: 'src/harbor.ts',
    snippets: [{ path: 'src/util.ts', symbol: 'label', text: 'export function label(value: string) { return value }' }],
    fim: true,
  })
  const budget = predictBudget('line')
  finishCompletion('name.trim()', 'export function harbor() {\n  const name = ', '\n}\n', 'line')
  void built
  void budget
  return performance.now() - started
}

async function main(): Promise<void> {
  const local: number[] = []
  for (let i = 0; i < rounds; i++) local.push(localOnce())
  const host: CompletionHost = {
    enabled: () => true,
    languageOn: () => true,
    modelId: () => 'qwen3.5-2b-q6_k',
    probeFim: async () => 1,
    snippets: async () => ({ imported: [], nearby: [] }),
    complete: async () => 'name.trim()',
    log: () => undefined,
  }
  const service = new CompletionService(host, 0)
  const serviceSamples: number[] = []
  for (let i = 0; i < rounds; i++) {
    const result = await service.suggest({
      sessionId: `bench-${i}`,
      path: 'src/harbor.ts',
      language: 'typescript',
      text: `export function harbor() {\n  const name = ${'x'.repeat(i % 3)}`,
      cursor: 0,
    })
    serviceSamples.push(result.latencyMs)
  }
  const report: Record<string, unknown> = {
    rounds,
    localP50Ms: Number(percentile(local, 50).toFixed(3)),
    serviceP50Ms: percentile(serviceSamples, 50),
    targetP50Ms: 300,
    note: 'serviceP50Ms is the in-process path with an instant model. Live 2B time is liveP50Ms when SURF_LLAMA_URL is set.',
  }
  const url = process.env.SURF_LLAMA_URL
  const key = process.env.SURF_LLAMA_KEY
  if (url && key) {
    const live: number[] = []
    const budget = predictBudget('line')
    for (let i = 0; i < 8; i++) {
      const started = performance.now()
      await llamaComplete(url, key, {
        prompt: buildCompletionPrompt({
          prefix: 'export function harbor() {\n  const name = ',
          suffix: '\n}\n',
          path: 'src/harbor.ts',
          snippets: [],
          fim: true,
        }).prompt,
        maxTokens: budget.maxTokens,
        stop: budget.stop,
        cachePrompt: true,
      })
      live.push(performance.now() - started)
    }
    report.liveP50Ms = Math.round(percentile(live, 50))
    report.liveUnderTarget = (report.liveP50Ms as number) < 300
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'benchmark failed')
  process.exitCode = 1
})
