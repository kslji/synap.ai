/**
 * Deterministic Step 11 checks. No model download and no network.
 * Each row is a real function result. A miss fails the eval gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanAccent, cleanAnimate, cleanDensity, cleanMascotName } from './appearance.js'
import { benchmarkFor, readBenchmarkFile, tokensPerSec, upsertBenchmark, writeBenchmarkFile, type BenchmarkRow } from './benchmark-store.js'
import { commandAllowed } from './code-agent/checks.js'
import { aggregateUsage, usageCsv, type UsageSample } from './live/metrics.js'
import { indiaEquityTax, profitLoss, sipFutureValue } from './finance-maths.js'
import { unableMessage, verifyGroundedAnswer, type SourceRecord } from './verify-answer.js'
import { classifyShotUse } from './vision/intent.js'
import { codeFitMark } from '../../shared/code-ram.js'
import { MASCOT_MANIFEST, pickClick } from '../../../../../packages/ui/src/mascot.js'
import { scoreEvalQuestions } from './step11-questions.js'

export interface Step11Row {
  id: string
  weight: number
  fields: { ok: boolean; detail: string }
}

const ROW: BenchmarkRow = {
  modelId: 'qwen3.5-2b',
  sizeBytes: 100,
  tokens: 8,
  elapsedMs: 400,
  tokensPerSec: 20,
  measuredAt: 1_700_000_000_000,
}

export function step11Cases(): Step11Row[] {
  const rows: Step11Row[] = []
  const check = (id: string, ok: boolean, detail = ok ? '' : id) => {
    rows.push({ id, weight: 1, fields: { ok, detail } })
  }

  const names: [unknown, string][] = [
    ['Surf Bot', 'Surf Bot'],
    ['  tide   bot  ', 'tide bot'],
    ['', 'Surf'],
    [null, 'Surf'],
    ['x'.repeat(80), 'x'.repeat(32)],
    ['Grok Bot', 'Grok Bot'],
  ]
  for (const [input, expected] of names) check(`name-${String(input).slice(0, 12)}`, cleanMascotName(input) === expected)

  for (const accent of ['orange', 'blue', 'indigo', 'navy'] as const) check(`accent-${accent}`, cleanAccent(accent) === accent)
  check('accent-system', cleanAccent('system') === 'orange')
  check('accent-empty', cleanAccent('') === 'orange')
  for (const density of ['compact', 'comfortable', 'relaxed'] as const) check(`density-${density}`, cleanDensity(density) === density)
  check('density-missing', cleanDensity(undefined) === 'comfortable')
  check('animate-true', cleanAnimate(true) === true)
  check('animate-false', cleanAnimate(false) === false)
  check('animate-missing', cleanAnimate(undefined, true) === true)
  check('animate-missing-off', cleanAnimate('yes', false) === false)

  check('speed-zero-tokens', tokensPerSec(0, 1000) === null)
  check('speed-zero-time', tokensPerSec(10, 0) === null)
  check('speed-negative', tokensPerSec(-1, 1000) === null)
  check('speed-nan', tokensPerSec(Number.NaN, 1000) === null)
  check('speed-20', tokensPerSec(8, 400) === 20)
  check('speed-round', tokensPerSec(1, 3000) === 0.3)
  const saved = readBenchmarkFile(writeBenchmarkFile([ROW]))
  check('bench-roundtrip', saved.length === 1 && saved[0]?.tokensPerSec === 20)
  check('bench-bad-json', readBenchmarkFile('{') .length === 0)
  check('bench-hide-stale', benchmarkFor(saved, ROW.modelId, 99) === null)
  check('bench-match', benchmarkFor(saved, ROW.modelId, 100)?.tokensPerSec === 20)
  const replaced = upsertBenchmark(saved, { ...ROW, tokensPerSec: 21, tokens: 21, elapsedMs: 1000 })
  check('bench-replace', replaced.length === 1 && replaced[0]?.tokensPerSec === 21)
  check('bench-reject', upsertBenchmark(saved, { ...ROW, tokens: 0 }).length === 1)

  const samples: UsageSample[] = [
    { at: Date.parse('2026-10-16T00:00:00.000Z'), modelId: 'qwen-2b', agentId: 'general', tasks: 1, steps: 1, tokensIn: 10, tokensOut: 4, ttftMs: 10, genMs: 1000, ramMb: 100, cpuPercent: 1 },
    { at: Date.parse('2026-10-16T01:00:00.000Z'), modelId: 'qwen-4b', agentId: 'code', tasks: 2, steps: 2, tokensIn: 20, tokensOut: 0, ttftMs: null, genMs: null, ramMb: null, cpuPercent: null },
  ]
  const csv = usageCsv(samples)
  check('csv-header', csv.startsWith('day,agent,model,requests,tokens_in,tokens_out,measured_tokens_per_sec\n'))
  check('csv-no-cost', !/cost|usd|\$/i.test(csv))
  check('csv-agent', csv.includes('general') && csv.includes('code'))
  check('csv-blank-speed', csv.split('\n').some((line) => line.includes('qwen-4b') && line.endsWith(',')))
  const report = aggregateUsage(samples)
  check('usage-agents', report.agents.length === 2)
  check('usage-local', report.localOnly === true)
  check('usage-no-prompt', !JSON.stringify(report).includes('secret prompt'))

  check('fit-recommended', codeFitMark({ family: 'qwen3.5', minRamGb: 4, defaultFor: ['code'] }, 8) === 'recommended')
  check('fit-ok', codeFitMark({ family: 'gemma', minRamGb: 8, defaultFor: [] }, 16) === 'fits')
  check('fit-big', codeFitMark({ family: 'gemma', minRamGb: 32, defaultFor: [] }, 8) === 'too-big')
  check('fit-4gb', codeFitMark({ family: 'qwen', minRamGb: 4, defaultFor: [] }, 4) === 'fits')

  check('cmd-test', commandAllowed('npm test', 'test') === true)
  check('cmd-lint', commandAllowed('npm run lint', 'lint') === true)
  check('cmd-types', commandAllowed('npm run typecheck', 'typecheck') === true)
  check('cmd-wrong-kind', commandAllowed('npm test', 'lint') === false)
  check('cmd-rm', commandAllowed('rm -rf /', 'test') === false)
  check('cmd-empty', commandAllowed('', 'test') === false)

  const shots: [string, number, string][] = [
    ['fix the TypeError', 1, 'error'],
    ['describe this screen', 1, 'describe'],
    ['compare the two screens', 2, 'compare'],
    ['fix the layout', 1, 'mockup'],
    ['build a component', 1, 'mockup'],
    ['the traceback is long', 1, 'error'],
  ]
  for (const [text, count, expected] of shots) check(`shot-${expected}-${count}-${text.slice(0, 12).replace(/\s+/g, '-')}`, classifyShotUse(text, count) === expected)

  check('sip-zero', sipFutureValue(100, 0, 12) === 1200)
  const i = 0.12 / 12
  const sip = 100 * (((1 + i) ** 12 - 1) / i)
  check('sip-rate', Math.abs(sipFutureValue(100, 0.12, 12) - sip) < 1e-6)
  check('pnl', profitLoss(2, 10, 15).pnl === 10 && profitLoss(2, 10, 15).pct === 0.5)
  check('tax-short', indiaEquityTax(1000, 10).tax === 200 && indiaEquityTax(1000, 10).kind === 'stcg')
  check('tax-long', indiaEquityTax(200_000, 400).tax === 75_000 * 0.125)
  check('sip-throws', (() => { try { sipFutureValue(-1, 0, 1); return false } catch { return true } })())

  const record: SourceRecord = { id: 'S1', kind: 'fact', text: 'The spare lamp code is PL-17.', url: '', asOf: null, cachedAt: null, stale: false }
  const kept = verifyGroundedAnswer({ answer: 'The spare lamp code is PL-17.', question: 'What is the spare lamp code?', records: [record], now: Date.parse('2026-10-16T00:00:00.000Z') })
  check('ground-keep', kept.blocked.length === 0 && kept.text.includes('PL-17'))
  const invented = verifyGroundedAnswer({ answer: 'See https://evil.example/nope', question: 'What is the spare lamp code?', records: [record], now: Date.parse('2026-10-16T00:00:00.000Z') })
  check('ground-block', invented.text === unableMessage('fact') && invented.blocked.length > 0)

  check('mascot-silent', MASCOT_MANIFEST.audio === false && MASCOT_MANIFEST.shipReferenceClips === false)
  check('mascot-states', Object.keys(MASCOT_MANIFEST.states).join(',') === 'idle,thinking,working,happy,oops,searching,reading,writing,permission,typing,offline,sleepy,benchmark,wink,guiding,notification,dizzy')
  check('mascot-clicks', MASCOT_MANIFEST.clicks.length === 3)
  check('click-0', pickClick(0).id === 'poke-squash')
  check('click-mid', pickClick(0.5).id === 'poke-dizzy')
  check('click-high', pickClick(0.99).id === 'wink')
  const here = dirname(fileURLToPath(import.meta.url))
  const css = readFileSync(join(here, '../../../../../packages/ui/src/blob.css'), 'utf8')
  check('css-think', css.includes('2.2s') && MASCOT_MANIFEST.states.thinking.durationMs === 2200)
  check('css-search', css.includes('0.7s') && MASCOT_MANIFEST.states.searching.durationMs === 700)
  const builder = readFileSync(join(here, '../../../electron-builder.cjs'), 'utf8')
  check('builder-no-mp4', builder.includes('!**/*.mp4') && !/from:\s*'animation\/mp4'/.test(builder))
  const manifest = JSON.parse(readFileSync(join(here, '../../../../../animation/manifest.json'), 'utf8')) as { audio: boolean; states: Record<string, { durationMs: number }> }
  check('manifest-silent', manifest.audio === false)
  check('manifest-think', manifest.states.thinking?.durationMs === MASCOT_MANIFEST.states.thinking.durationMs)

  const extra = [
    ['qwen-2b', 4, 'fits'],
    ['qwen-4b', 8, 'fits'],
    ['qwen-9b', 16, 'fits'],
    ['qwen-huge', 32, 'too-big'],
  ] as const
  for (const [id, ram, expected] of extra) {
    const mark = codeFitMark({ family: 'qwen', minRamGb: ram, defaultFor: [] }, ram === 32 ? 8 : ram)
    check(`ram-${id}`, mark === expected)
  }
  for (let n = 1; n <= 24; n += 1) {
    check(`sip-months-${n}`, sipFutureValue(10, 0, n) === 10 * n)
  }

  rows.push(...scoreEvalQuestions())
  return rows
}
