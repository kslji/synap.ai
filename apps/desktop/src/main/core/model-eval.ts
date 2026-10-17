/**
 * Real-model scoring for the Step 11 question bank.
 * The deterministic suite still scores the same questions with product functions.
 * Coding, splitting, run/fix, and finance ask the local model for one label.
 * No-fabrication scores the verifier: a missing source does not call the model,
 * and a number, price, date, URL, section, or quote that is not in a fetched record is removed.
 */
import { evalQuestions, type EvalQuestion, type QuestionDomain } from './step11-questions.js'

export const FULL_MODEL_IDS = ['qwen3.5-2b-q4_k_m', 'qwen3.5-4b-q4_k_m', 'qwen3.5-9b-q4_k_m'] as const

const SUBSET_TAKE: { domain: QuestionDomain; count: number }[] = [
  { domain: 'coding', count: 10 },
  { domain: 'splitting', count: 8 },
  { domain: 'run-fix', count: 6 },
  { domain: 'finance', count: 12 },
  { domain: 'no-fabrication', count: 10 },
]

const GLOSS: Record<string, string> = {
  'coding:allow': 'the command may run for that check',
  'coding:refuse': 'the command must not run',
  'coding:recommended': 'the model is the recommended fit',
  'coding:too-big': 'the model does not fit the laptop',
  'coding:fits': 'the model fits the laptop',
  'coding:code-only': 'only rows for the code agent',
  'coding:not-code': 'a general row stays off the code agent',
  'splitting:chat': 'no code change: what something does, or explain a file',
  'splitting:edit': 'quick fix, typo, one-line, or just change, and only one file',
  'splitting:plan': 'two different files, even for a rename; also migrate, refactor, across, and then, or step by step',
  'splitting:accept': 'the plan is valid',
  'splitting:reject': 'the plan is invalid',
  'run-fix:pass': 'the check is clean, or the only failure was already fixed or already outside the change',
  'run-fix:regression': 'the patch introduced a new error',
  'run-fix:fail': 'the check failed or an old error remains, and the patch did not add a new one',
  'run-fix:allow': 'the command may run',
  'run-fix:refuse': 'the command must not run',
  'finance:sip': 'a monthly investment future value',
  'finance:sip-zero': 'a monthly investment at zero interest',
  'finance:pnl': 'a profit',
  'finance:pnl-loss': 'a loss',
  'finance:stcg': 'India equity tax on a gain held under 365 days',
  'finance:ltcg': 'India equity tax on a gain held 365 days or more',
  'finance:not-india': 'the India equity tax table is not used outside India',
  'finance:symbol': 'a ticker written in quotes when the question does not mention a bhav file or fixture',
  'finance:bitcoin': 'the bitcoin id',
  'finance:nav': 'a mutual-fund NAV line',
  'finance:eod': 'a closing price from a saved bhav file, even when it is not from the network',
  'finance:disclaimer': 'the question asks for the formula and says it is not a recommendation',
  'no-fabrication:keep-fact': 'a sourced fact stays',
  'no-fabrication:block-url': 'a link that is not in the source is removed',
  'no-fabrication:block-price': 'an unsourced price is removed',
  'no-fabrication:block-date': 'a future date is removed',
  'no-fabrication:block-live': 'a cached row is not the live price',
  'no-fabrication:keep-when-sourced': 'a sentence that is in the source stays',
  'no-fabrication:block': 'an unsourced number is replaced',
  'no-fabrication:keep': 'a quoted source sentence stays',
  'no-fabrication:keep-money': 'a sourced amount stays',
  'screenshots:error:1': 'one screenshot of an error',
  'screenshots:describe:1': 'one screenshot to describe',
  'screenshots:mockup:1': 'one screenshot of a layout',
  'screenshots:compare:2': 'two screenshots to compare',
  'fresh:fresh': 'the question needs current information',
  'fresh:local': 'the question can be answered from local files',
  'fresh:blend': 'local answer plus a fresh lookup',
  'fresh:refuse': 'web search is not available',
  'fresh:web': 'search the web',
  'legal:topic-legal': 'a statute question',
  'legal:topic-legal-act': 'a statute question',
  'legal:keep-section': 'the section is in the source',
  'legal:block-section': 'the section is not in the source',
  'legal:unable': 'no source, so no section',
  'legal:keep-quote': 'the quote is in the source',
  'legal:block-url': 'the link is not in the source',
  'legal:not-price': 'not a price question',
  'legal:unable-line': 'the legal unable sentence',
}

export interface ModelEvalThresholds {
  /** Floor for the CI subset. */
  minAccuracy: number
  minNoFabrication: number
  /** Floor for the 101-question run. The subset job does not use this. */
  fullMinAccuracy?: number
}

export interface ModelAnswerRow {
  id: string
  domain: string
  ok: boolean
  label: string
  ttftMs: number | null
  tokens: number
  genMs: number
}

export interface MmprojMeasure {
  measured: boolean
  sha256: string
  peakRssMb: number | null
  replied: boolean
  reason?: string
}

export interface MeasuredModel {
  id: string
  sha256: string
  measured: boolean
  reason?: string
  accuracy: number | null
  noFabrication: number | null
  tokensPerSec: number | null
  ttftMs: number | null
  peakRssMb: number | null
  questions: number
  tokenizer?: 'gguf' | 'tokenizer.json'
  mmproj?: MmprojMeasure
}

export function selectModelEvalQuestions(mode: 'subset' | 'full', questions: EvalQuestion[] = evalQuestions()): EvalQuestion[] {
  const modelQuestions = questions.filter((item) => item.domain !== 'everyday')
  if (mode === 'full') return modelQuestions
  const picked: EvalQuestion[] = []
  for (const row of SUBSET_TAKE) picked.push(...modelQuestions.filter((item) => item.domain === row.domain).slice(0, row.count))
  return picked
}

export function labelsFor(questions: EvalQuestion[], domain: string): string[] {
  return [...new Set(questions.filter((item) => item.domain === domain).map((item) => item.expect))].sort()
}

const DOMAIN_RULES: Partial<Record<QuestionDomain, string>> = {
  splitting: 'Rules: chat when the task does not ask to change code. plan when two different files are named, even if the verb is rename or fix. edit only for a quick fix, typo, one-line, or just change in one file. Also plan for migrate, refactor, across, and then, or step by step.',
  'run-fix': 'Rules: regression when the patch introduced a new error. fail when a check failed or an old error remains and nothing new was introduced. pass when the check is clean, the only failure was already fixed, or it was already outside the change.',
  finance: 'Rules: held under 365 days is stcg. Held 365 days or more is ltcg. not-india only when the region is outside India. A bhav file or fixture close is eod even if it says not from the network. disclaimer only when the question asks for the formula and a non-recommendation.',
}

/** Answer vocabulary for one question. The expected label is not included on its own. */
export function choiceLabels(question: EvalQuestion, bank: EvalQuestion[]): string[] {
  const domainLabels = labelsFor(bank, question.domain)
  const text = question.question
  if (question.domain === 'coding') {
    if (question.expect === 'allow' || question.expect === 'refuse') return ['allow', 'refuse']
    if (question.expect === 'code-only' || question.expect === 'not-code') return ['code-only', 'not-code']
    return ['recommended', 'too-big', 'fits']
  }
  if (question.domain === 'splitting') {
    if (question.expect === 'accept' || question.expect === 'reject') return ['accept', 'reject']
    return ['chat', 'edit', 'plan']
  }
  if (question.domain === 'run-fix') {
    if (question.expect === 'allow' || question.expect === 'refuse') return ['allow', 'refuse']
    return ['pass', 'regression', 'fail']
  }
  if (question.domain === 'finance') {
    if (/\b(formula|recommendation|disclaimer)\b/i.test(text)) return ['disclaimer', 'sip', 'not-india']
    if (/\bsip\b/i.test(text)) return ['sip', 'sip-zero']
    if (/\b(bought|sold)\b/i.test(text)) return ['pnl', 'pnl-loss']
    if (/\b(equity tax|stcg|ltcg|capital gain)\b/i.test(text)) return ['stcg', 'ltcg', 'not-india']
    if (/\b(bhav|fixture|close for)\b/i.test(text)) return ['eod', 'not-india', 'symbol']
    if (/\bbitcoin\b/i.test(text)) return ['bitcoin', 'symbol', 'nav']
    if (/\bnav line\b/i.test(text)) return ['nav', 'eod', 'symbol']
    if (/"[A-Z]{2,}"/.test(text)) return ['symbol', 'eod', 'bitcoin']
  }
  return domainLabels
}

export function labelGloss(domain: string, label: string): string {
  return GLOSS[`${domain}:${label}`] ?? label
}

export function modelEvalPrompt(question: EvalQuestion, labels: string[]): string {
  const lines = labels.map((label) => `${label} — ${labelGloss(question.domain, label)}`)
  const rules = DOMAIN_RULES[question.domain]
  const head = rules ? `Reply with exactly one label and no other words.\n${rules}` : 'Reply with exactly one label and no other words.'
  return `${head}\n${lines.join('\n')}\nQuestion: ${question.question}`
}

/** Ask the model to answer from the fetched record. The verifier still checks the reply. */
export function fabricationPrompt(question: string, sources: string[]): string {
  return `Answer using only the source text. Do not add a number, price, date, URL, section, or quote that is not written in the source.\nSource:\n${sources.join('\n')}\nQuestion: ${question}`
}

export function labelGrammar(labels: string[]): string {
  const alts = labels.map((label) => `"${label.replace(/["\\]/g, '')}"`)
  return `root ::= ${alts.join(' | ')}`
}

export function scoreModelLabel(reply: string, expect: string, labels: string[]): { ok: boolean; label: string } {
  const cleaned = reply.trim().split(/\s+/)[0]?.replace(/^[^A-Za-z0-9:-]+|[^A-Za-z0-9:-]+$/g, '') ?? ''
  const hit = labels.find((label) => label.toLowerCase() === cleaned.toLowerCase()) ?? ''
  return { ok: hit === expect, label: hit || cleaned.slice(0, 40) }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid]
  if (upper == null) return null
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[mid - 1]
  return lower == null ? upper : (lower + upper) / 2
}

export function summarizeAnswers(rows: ModelAnswerRow[]): {
  questions: number
  correct: number
  accuracy: number
  noFabrication: { questions: number; correct: number; accuracy: number }
  tokensPerSec: number | null
  ttftMs: number | null
} {
  const correct = rows.filter((row) => row.ok).length
  const fab = rows.filter((row) => row.domain === 'no-fabrication')
  const fabCorrect = fab.filter((row) => row.ok).length
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0)
  const genMs = rows.reduce((sum, row) => sum + Math.max(0, row.genMs), 0)
  const ttfts = rows.flatMap((row) => (row.ttftMs == null ? [] : [row.ttftMs]))
  return {
    questions: rows.length,
    correct,
    accuracy: rows.length ? correct / rows.length : 0,
    noFabrication: {
      questions: fab.length,
      correct: fabCorrect,
      accuracy: fab.length ? fabCorrect / fab.length : 0,
    },
    tokensPerSec: tokens > 0 && genMs > 0 ? tokens / (genMs / 1000) : null,
    ttftMs: median(ttfts),
  }
}

export function loadThresholds(json: unknown): ModelEvalThresholds {
  const row = json as { minAccuracy?: unknown; minNoFabrication?: unknown; fullMinAccuracy?: unknown }
  if (typeof row.minAccuracy !== 'number' || typeof row.minNoFabrication !== 'number') {
    throw new Error('model-eval thresholds need minAccuracy and minNoFabrication')
  }
  if (row.minAccuracy < 0 || row.minAccuracy > 1 || row.minNoFabrication < 0 || row.minNoFabrication > 1) {
    throw new Error('model-eval thresholds must be between 0 and 1')
  }
  if (row.fullMinAccuracy != null && (typeof row.fullMinAccuracy !== 'number' || row.fullMinAccuracy < 0 || row.fullMinAccuracy > 1)) {
    throw new Error('model-eval fullMinAccuracy must be between 0 and 1')
  }
  return {
    minAccuracy: row.minAccuracy,
    minNoFabrication: row.minNoFabrication,
    ...(typeof row.fullMinAccuracy === 'number' ? { fullMinAccuracy: row.fullMinAccuracy } : {}),
  }
}

export function accuracyFloor(thresholds: ModelEvalThresholds, mode: 'subset' | 'full'): number {
  if (mode === 'full' && thresholds.fullMinAccuracy != null) return thresholds.fullMinAccuracy
  return thresholds.minAccuracy
}

export function passesThresholds(accuracy: number, noFabrication: number, thresholds: ModelEvalThresholds, mode: 'subset' | 'full' = 'subset'): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  const floor = accuracyFloor(thresholds, mode)
  if (accuracy < floor) reasons.push(`accuracy ${accuracy.toFixed(3)} is below ${floor}`)
  if (noFabrication < thresholds.minNoFabrication) reasons.push(`no-fabrication ${noFabrication.toFixed(3)} is below ${thresholds.minNoFabrication}`)
  return { ok: reasons.length === 0, reasons }
}

/** 16 GB tier uses 16384 context. Smaller laptops stay at 8192. */
export function evalContextTokens(minRamGb: number): number {
  return minRamGb >= 16 ? 16384 : 8192
}

export function ramAllows(availableGb: number | null, minRamGb: number): boolean {
  if (availableGb == null) return true
  return availableGb + 0.4 >= minRamGb
}

export function mmprojRamAllows(availableGb: number | null, minRamGb: number, mmprojBytes: number): boolean {
  if (availableGb == null) return true
  return availableGb + 0.4 >= minRamGb + mmprojBytes / 1024 ** 3
}

export function tokenizerUrl(ggufUrl: string): string {
  return ggufUrl.replace(/[^/]+$/, 'tokenizer.json')
}

export function coverSkips(run: MeasuredModel[], saved: MeasuredModel[]): MeasuredModel[] {
  return FULL_MODEL_IDS.map((id) => {
    const live = run.find((row) => row.id === id && row.measured)
    if (live?.mmproj?.measured) return live
    const prior = saved.find((row) => row.id === id && row.measured)
    if (live && prior?.mmproj?.measured && !live.mmproj?.measured) return { ...live, mmproj: prior.mmproj }
    if (live) return live
    if (prior) return prior
    const missed = run.find((row) => row.id === id)
    return missed ?? {
      id,
      sha256: '',
      measured: false,
      reason: 'missing',
      accuracy: null,
      noFabrication: null,
      tokensPerSec: null,
      ttftMs: null,
      peakRssMb: null,
      questions: 0,
    }
  })
}

export function releaseGate(models: MeasuredModel[], thresholds: ModelEvalThresholds): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  for (const row of models) {
    if (!row.measured || row.accuracy == null || row.noFabrication == null || row.tokensPerSec == null || row.ttftMs == null || row.peakRssMb == null) {
      reasons.push(`${row.id}: not measured${row.reason ? ` (${row.reason})` : ''}. On a Mac, run ./scripts/model-eval-full.sh and commit harness/baselines/model-eval-full.json`)
      continue
    }
    const judged = passesThresholds(row.accuracy, row.noFabrication, thresholds, 'full')
    reasons.push(...judged.reasons.map((reason) => `${row.id}: ${reason}`))
    if (!row.mmproj?.measured || !row.mmproj.replied || row.mmproj.peakRssMb == null) {
      reasons.push(`${row.id}: mmproj screenshot add-on was not measured`)
    }
  }
  return { ok: reasons.length === 0, reasons }
}
