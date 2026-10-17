/**
 * Step 11 question bank. Each question is scored by a real function.
 * No model download and no network. A miss fails the eval gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { commandAllowed } from './code-agent/checks.js'
import { judgeCheck, type Classified } from './code-agent/fix-loop.js'
import { triageTask, validatePlan, type PlanFacts } from './code-agent/plan.js'
import type { Diagnostic } from './code-agent/diagnostics.js'
import {
  coinId,
  FINANCE_DISCLAIMER,
  indiaEquityTax,
  parseAmfiNav,
  parseBhavCsv,
  parsePnlQuestion,
  parseSipQuestion,
  profitLoss,
  sipAnswer,
  sipFutureValue,
  stockSymbol,
  taxAnswer,
} from './search/finance.js'
import { claimTopic, unableMessage, verifyGroundedAnswer, type SourceRecord } from './search/verify-answer.js'
import { decideWeb, wantsFresh } from './web-decision.js'
import { classifyShotUse } from './vision/intent.js'
import { codeFitMark } from '../../shared/code-ram.js'
import { servesAgent } from '../../shared/model-label.js'
import { handle } from './calculator.worker.js'
import { DEVICE_REPLY, mathJob, phraseMath, routeTurn } from './chat-route.js'
import { finishReply, replyShapeOk } from '../../shared/reply-text.js'
import type { Step11Row } from './step11-cases.js'

export type QuestionDomain = 'coding' | 'splitting' | 'run-fix' | 'screenshots' | 'fresh' | 'finance' | 'legal' | 'no-fabrication' | 'everyday'

export interface EvalQuestion {
  id: string
  domain: QuestionDomain
  question: string
  expect: string
}

const NOW = Date.parse('2026-10-16T00:00:00.000Z')
const FACTS: PlanFacts = {
  indexed: true,
  files: ['src/app.ts', 'src/helper.ts'],
  symbols: [{ name: 'start', qualified: 'start', kind: 'function', path: 'src/app.ts' }],
  edges: [],
}

const registry = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../resources/models.registry.json'), 'utf8')) as {
  models: { id: string; role: string; agents?: string[] }[]
}

function diag(file: string, line: number, message: string): Diagnostic {
  return { file, line, column: 1, message, rule: 'TS2304', source: 'tsc' }
}

function report(partial: Partial<Classified>): Classified {
  return { fixed: [], introduced: [], preExisting: [], inScope: [], ...partial }
}

function plan(steps: { id: string; files: string[]; depends: string[]; create?: boolean }[]): { steps: object[] } {
  return {
    steps: steps.map((step) => ({
      id: step.id,
      goal: `Do ${step.id}`,
      files: step.files,
      symbols: [],
      depends_on: step.depends,
      check: { kind: 'test', command: 'npm test' },
      create: step.create === true,
    })),
  }
}

function source(text: string, kind: SourceRecord['kind'] = 'fact'): SourceRecord {
  return { id: 'S1', kind, text, url: 'https://example.test/source', asOf: '2026-10-15', cachedAt: null, stale: false }
}

function grounded(question: string, answer: string, records: SourceRecord[]): { text: string; blocked: string[] } {
  return verifyGroundedAnswer({ question, answer, records, now: NOW })
}

export function evalQuestions(): EvalQuestion[] {
  const questions: EvalQuestion[] = []
  const add = (domain: QuestionDomain, id: string, question: string, expect: string) => {
    questions.push({ id: `q-${domain}-${id}`, domain, question, expect })
  }

  const commands: [string, 'test' | 'lint' | 'typecheck', boolean][] = [
    ['npm test', 'test', true],
    ['npm run lint', 'lint', true],
    ['npm run typecheck', 'typecheck', true],
    ['npx eslint .', 'lint', true],
    ['npx tsc --noEmit', 'typecheck', true],
    ['pytest -q', 'test', true],
    ['ruff check .', 'lint', true],
    ['pyright', 'typecheck', true],
    ['rm -rf /', 'test', false],
    ['curl https://evil.example', 'test', false],
    ['npm test', 'lint', false],
    ['eslint src', 'test', false],
    ['cargo test', 'test', true],
    ['go test ./...', 'test', true],
    ['make test', 'lint', false],
  ]
  for (const [command, kind, allowed] of commands) {
    add('coding', `${kind}-${command.slice(0, 18).replace(/\W+/g, '-')}`, `May the code agent run "${command}" as a ${kind} check?`, allowed ? 'allow' : 'refuse')
  }
  add('coding', 'fit-2b', 'On an 8 GB laptop, is the default Qwen3.5 2B code model recommended?', 'recommended')
  add('coding', 'fit-4b-small', 'On a 4 GB laptop, does a model that needs 16 GB fit?', 'too-big')
  add('coding', 'fit-9b', 'On a 16 GB laptop, does a Qwen row that needs 16 GB fit?', 'fits')
  add('coding', 'registry-code', 'Does the code agent list only registry rows whose agents include code?', 'code-only')
  add('coding', 'registry-general', 'Does a chat row with no agents list stay off the code agent?', 'not-code')

  const splits: [string, string][] = [
    ['What does start do?', 'chat'],
    ['Explain src/app.ts', 'chat'],
    ['Fix the typo in src/app.ts', 'edit'],
    ['Quick fix the broken return', 'edit'],
    ['Just change the label', 'edit'],
    ['Refactor the parser across every file', 'plan'],
    ['Migrate the helpers and then update the callers', 'plan'],
    ['Rename start in src/app.ts and src/helper.ts', 'plan'],
    ['Add a retry step by step', 'plan'],
    ['Write a one-line comment in src/app.ts', 'edit'],
    ['How is the helper used?', 'chat'],
  ]
  for (const [question, expect] of splits) add('splitting', expect + '-' + question.slice(0, 16).replace(/\W+/g, '-'), question, expect)
  add('splitting', 'plan-ok', 'Accept a two-step plan that creates src/new.ts and then edits src/app.ts.', 'accept')
  add('splitting', 'plan-cycle', 'Reject a plan where step a depends on b and b depends on a.', 'reject')
  add('splitting', 'plan-missing', 'Reject a plan that edits src/missing.ts without create.', 'reject')
  add('splitting', 'plan-self', 'Reject a plan whose only step depends on itself.', 'reject')

  const fixes: [string, string][] = [
    ['The check is clean and the command passed.', 'pass'],
    ['The patch introduced a new TypeError in src/app.ts.', 'regression'],
    ['An in-scope failure is still in src/app.ts.', 'fail'],
    ['The command failed and printed no diagnostics.', 'fail'],
    ['A pre-existing failure is outside the step files and the command passed.', 'pass'],
    ['The command failed but the only diagnostic was already fixed.', 'pass'],
  ]
  for (const [question, expect] of fixes) add('run-fix', expect + '-' + question.slice(0, 18).replace(/\W+/g, '-'), question, expect)
  add('run-fix', 'npm-test-allowed', 'After a failed check, may the fix loop run npm test?', 'allow')
  add('run-fix', 'shell-refused', 'After a failed check, may the fix loop run rm -rf /?', 'refuse')
  add('run-fix', 'lint-allowed', 'After a failed check, may the fix loop run npm run lint?', 'allow')
  add('run-fix', 'network-refused', 'After a failed check, may the fix loop run curl https://evil.example?', 'refuse')

  const shots: [string, number, string][] = [
    ['fix the TypeError in this screenshot', 1, 'error'],
    ['the traceback is on the screen', 1, 'error'],
    ['this crash should be quoted', 1, 'error'],
    ['describe this screen', 1, 'describe'],
    ['what is on the screen', 1, 'describe'],
    ['build a component from this layout', 1, 'mockup'],
    ['fix the layout', 1, 'mockup'],
    ['implement the design', 1, 'mockup'],
    ['compare the two screens', 2, 'compare'],
    ['what differs versus the expected screen', 2, 'compare'],
    ['describe a single screenshot', 1, 'describe'],
    ['fix the ReferenceError', 1, 'error'],
    ['the bug is visible in the screenshot', 1, 'error'],
  ]
  for (const [question, count, expect] of shots) add('screenshots', `${expect}-${count}-${question.slice(0, 14).replace(/\W+/g, '-')}`, question, `${expect}:${count}`)

  const freshYes = ['What is the price today?', 'Latest headline', 'Prices for this name', 'News from 2026']
  const freshNo = ['Summarise the attached note', 'What is in yesterday note', 'Hello there', 'Explain the helper']
  for (const question of freshYes) add('fresh', 'yes-' + question.slice(0, 16).replace(/\W+/g, '-'), question, 'fresh')
  for (const question of freshNo) add('fresh', 'no-' + question.slice(0, 16).replace(/\W+/g, '-'), question, 'local')
  add('fresh', 'blend', 'A strong local answer plus a fresh question, online, web allowed.', 'blend')
  add('fresh', 'refuse-offline', 'A fresh question while offline-only is on.', 'refuse')
  add('fresh', 'web-weak', 'Local sources are insufficient and web search is allowed.', 'web')
  add('fresh', 'local-strong', 'A strong local answer and the question is not fresh.', 'local')

  const finance: [string, string][] = [
    ['SIP of 100 per month at 12% for 12 months', 'sip'],
    ['SIP of 50 per month at 0% for 6 months', 'sip-zero'],
    ['Bought at 10 and sold at 15 with 2 shares', 'pnl'],
    ['Bought at 20 and sold at 10 with 4 shares', 'pnl-loss'],
    ['India equity tax on a gain of 1000 held 10 days', 'stcg'],
    ['India equity tax on a gain of 200000 held 400 days', 'ltcg'],
    ['Apply the India equity tax table in a non-India region', 'not-india'],
    ['What is the price of "RELIANCE" today?', 'symbol'],
    ['What is the bitcoin price?', 'bitcoin'],
    ['NAV line 120503;INF1;INF2;Sample Fund;42.5;16-Oct-2026', 'nav'],
  ]
  for (const [question, expect] of finance) add('finance', expect, question, expect)
  add('finance', 'eod-fixture', 'Close for RELIANCE from a fixture bhav copy, not from the network.', 'eod')
  add('finance', 'disclaimer', 'A SIP answer names the formula and says it is not a recommendation.', 'disclaimer')

  const legal: [string, string][] = [
    ['What does section 17 of the penal code say?', 'topic-legal'],
    ['Quote section 17 from the source that contains it.', 'keep-section'],
    ['The model wrote section 99, which is not in the source.', 'block-section'],
    ['A legal answer with no source must not invent a section.', 'unable'],
    ['Is this a news headline or a statute question: section 4 of the act?', 'topic-legal-act'],
  ]
  for (const [question, expect] of legal) add('legal', expect, question, expect)
  add('legal', 'keep-quote', 'Keep a legal sentence that is copied from the source.', 'keep-quote')
  add('legal', 'block-url', 'Block a legal answer that adds a link the source does not have.', 'block-url')
  add('legal', 'no-advice-price', 'A statute question is not scored as a price question.', 'not-price')
  add('legal', 'unable-message', 'When a section is missing, the reply is the legal unable line.', 'unable-line')

  const fabricated: [string, string][] = [
    ['The spare lamp code is PL-17.', 'keep-fact'],
    ['See https://evil.example/nope for the lamp code.', 'block-url'],
    ['The price is 99.50 today.', 'block-price'],
    ['The page is dated 2099-01-01.', 'block-date'],
    ['This is the live price from the cache.', 'block-live'],
    ['section 17 is the rule.', 'keep-when-sourced'],
  ]
  for (const [question, expect] of fabricated) add('no-fabrication', expect, question, expect)
  add('no-fabrication', 'empty-source', 'An answer that states a number with no source is replaced.', 'block')
  add('no-fabrication', 'quote-kept', 'A quoted sentence that appears in the source is kept.', 'keep')
  add('no-fabrication', 'money-kept', 'A rupee amount that appears in the source is kept.', 'keep-money')
  add('no-fabrication', 'stale-not-live', 'A cached row must not be described as the current price.', 'block')

  const everyday: [string, string, string][] = [
    ['what-is-2-plus-2', 'what is 2+2', 'math'],
    ['what-2-plus-2', 'what 2+2', 'math'],
    ['whats-2-plus-2', "what's 2+2?", 'math'],
    ['whats-plain-2-plus-2', 'whats 2+2', 'math'],
    ['how-much-is-2-plus-2', 'how much is 2 + 2', 'math'],
    ['calculate-2-plus-2', 'calculate 2 + 2', 'math'],
    ['bare-2-plus-2', '2+2', 'math'],
    ['hello', 'hello', 'model'],
    ['explain-variable', 'Explain what a variable is in one sentence.', 'model'],
    ['capital-of-france', 'What is the capital of France?', 'model'],
    ['js-add', 'Write a JavaScript function that adds two numbers.', 'model'],
    ['control-laptop', 'control the laptop', 'device'],
    ['open-files', 'open files', 'device'],
    ['take-control-mac-pc', 'take control of the Mac or PC', 'device'],
    ['take-control-laptop', 'take control of my laptop', 'device'],
  ]
  for (const [id, question, expect] of everyday) add('everyday', id, question, expect)

  return questions
}

export function scoreEvalQuestions(): Step11Row[] {
  return evalQuestions().map((item) => {
    const ok = answerMatches(item)
    return { id: item.id, weight: 1, fields: { ok, detail: ok ? item.domain : `${item.domain}: ${item.question}` } }
  })
}

function answerMatches(item: EvalQuestion): boolean {
  if (item.domain === 'coding') return scoreCoding(item)
  if (item.domain === 'splitting') return scoreSplitting(item)
  if (item.domain === 'run-fix') return scoreFix(item)
  if (item.domain === 'screenshots') return scoreShot(item)
  if (item.domain === 'fresh') return scoreFresh(item)
  if (item.domain === 'finance') return scoreFinance(item)
  if (item.domain === 'legal') return scoreLegal(item)
  if (item.domain === 'everyday') return scoreEveryday(item)
  return scoreFabrication(item)
}

/** The reply a person would see for an everyday question, when this suite can produce one. */
export function everydayVisible(item: EvalQuestion): string | null {
  if (item.domain !== 'everyday') return null
  if (item.expect === 'device') return DEVICE_REPLY
  if (item.expect !== 'math') return null
  const plan = routeTurn({ text: item.question, webChip: false, online: true, offlineOnly: false, hasFolder: false })
  if (plan.kind !== 'math' || plan.math?.kind !== 'calc') return null
  const ran = handle({ id: 1, kind: 'calc', expression: plan.math.expression })
  if (!ran.ok) return null
  return phraseMath(plan.math.label, ran.result, '')
}

/** Calculator, model, or the honest device reply. These do not call a model. */
function scoreEveryday(item: EvalQuestion): boolean {
  const base = { text: item.question, webChip: false as const, online: true, offlineOnly: false, hasFolder: false }
  const plan = routeTurn(base)
  const visible = everydayVisible(item)
  if (visible != null && !replyShapeOk(finishReply(visible, false).text)) return false
  if (item.expect === 'model') return plan.kind === 'model' && mathJob(item.question) == null
  if (item.expect === 'device') {
    return plan.kind === 'device' && routeTurn({ ...base, hasFolder: true }).kind === 'device'
  }
  if (item.expect !== 'math' || plan.kind !== 'math' || plan.math?.kind !== 'calc') return false
  if (plan.math.expression.replace(/\s+/g, '') !== '2+2') return false
  const ran = handle({ id: 1, kind: 'calc', expression: plan.math.expression })
  if (!ran.ok || ran.result !== '4') return false
  const phrase = phraseMath(plan.math.label, ran.result, 'I think it might be five.')
  return phrase.includes('4') && !/Unable to find|worldwide sources/i.test(phrase)
}

function scoreCoding(item: EvalQuestion): boolean {
  if (item.expect === 'recommended') return codeFitMark({ family: 'qwen3.5', minRamGb: 4, defaultFor: ['code'] }, 8) === 'recommended'
  if (item.expect === 'too-big') return codeFitMark({ family: 'qwen', minRamGb: 16, defaultFor: [] }, 4) === 'too-big'
  if (item.expect === 'fits') return codeFitMark({ family: 'qwen', minRamGb: 16, defaultFor: [] }, 16) === 'fits'
  if (item.expect === 'code-only') {
    const code = registry.models.filter((model) => model.role === 'chat' && servesAgent(model.agents, 'code'))
    return code.length > 0 && code.every((model) => model.agents?.includes('code'))
  }
  if (item.expect === 'not-code') {
    const general = registry.models.find((model) => model.role === 'chat' && !model.agents)
    return general != null && servesAgent(general.agents, 'code') === false && servesAgent(general.agents, 'general') === true
  }
  const command = item.question.match(/"([^"]+)"/)?.[1] ?? ''
  const kind = item.question.match(/as a (test|lint|typecheck) check/)?.[1]
  if (kind !== 'test' && kind !== 'lint' && kind !== 'typecheck') return false
  return commandAllowed(command, kind) === (item.expect === 'allow')
}

function scoreSplitting(item: EvalQuestion): boolean {
  if (item.expect === 'accept') {
    const parsed = validatePlan(plan([{ id: 'a', files: ['src/new.ts'], depends: [], create: true }, { id: 'b', files: ['src/app.ts'], depends: ['a'] }]), FACTS)
    return parsed.ok === true
  }
  if (item.expect === 'reject' && item.id.endsWith('plan-cycle')) {
    const parsed = validatePlan(plan([{ id: 'a', files: ['src/app.ts'], depends: ['b'] }, { id: 'b', files: ['src/helper.ts'], depends: ['a'] }]), FACTS)
    return parsed.ok === false
  }
  if (item.expect === 'reject' && item.id.endsWith('plan-missing')) {
    const parsed = validatePlan(plan([{ id: 'a', files: ['src/missing.ts'], depends: [] }]), FACTS)
    return parsed.ok === false
  }
  if (item.expect === 'reject' && item.id.endsWith('plan-self')) {
    const parsed = validatePlan(plan([{ id: 'a', files: ['src/app.ts'], depends: ['a'] }]), FACTS)
    return parsed.ok === false
  }
  return triageTask(item.question, FACTS.files) === item.expect
}

function scoreFix(item: EvalQuestion): boolean {
  if (item.expect === 'allow') return commandAllowed(item.question.includes('lint') ? 'npm run lint' : 'npm test', item.question.includes('lint') ? 'lint' : 'test')
  if (item.expect === 'refuse') return commandAllowed(item.question.includes('curl') ? 'curl https://evil.example' : 'rm -rf /', 'test') === false
  const cases: Record<string, { classified: Classified; commandOk: boolean; parsed: number }> = {
    pass: { classified: report({}), commandOk: true, parsed: 0 },
    regression: { classified: report({ introduced: [diag('src/app.ts', 4, 'new')] }), commandOk: true, parsed: 1 },
    fail: item.question.includes('in-scope')
      ? { classified: report({ inScope: [diag('src/app.ts', 2, 'still')] }), commandOk: true, parsed: 1 }
      : { classified: report({}), commandOk: false, parsed: 0 },
  }
  if (item.question.startsWith('The command failed but')) {
    const judged = judgeCheck(report({ fixed: [diag('src/app.ts', 3, 'gone')] }), false, 1)
    return judged.ok === true && judged.regression === false
  }
  if (item.question.startsWith('A pre-existing')) {
    const judged = judgeCheck(report({ preExisting: [diag('other.ts', 1, 'old')] }), true, 1)
    return judged.ok === true
  }
  const row = cases[item.expect]
  if (!row) return false
  const judged = judgeCheck(row.classified, row.commandOk, row.parsed)
  if (item.expect === 'pass') return judged.ok && !judged.regression
  if (item.expect === 'regression') return !judged.ok && judged.regression
  return !judged.ok && !judged.regression
}

function scoreShot(item: EvalQuestion): boolean {
  const [expect, countText] = item.expect.split(':')
  return classifyShotUse(item.question, Number(countText)) === expect
}

function scoreFresh(item: EvalQuestion): boolean {
  if (item.expect === 'fresh') return wantsFresh(item.question) === true
  if (item.expect === 'local' && item.id.includes('local-strong')) {
    return decideWeb({ local: 'answer', fresh: false, online: true, offlineOnly: false, webAllowed: true }).branch === 'local'
  }
  if (item.expect === 'local') return wantsFresh(item.question) === false
  if (item.expect === 'blend') return decideWeb({ local: 'answer', fresh: true, online: true, offlineOnly: false, webAllowed: true }).branch === 'blend'
  if (item.expect === 'refuse') return decideWeb({ local: 'skip', fresh: true, online: false, offlineOnly: true, webAllowed: true }).branch === 'refuse'
  if (item.expect === 'web') return decideWeb({ local: 'insufficient', fresh: false, online: true, offlineOnly: false, webAllowed: true }).branch === 'web'
  return false
}

/** Finance figures come from the in-app formula. The model is not the source. */
export function financeAnswerOk(item: EvalQuestion): boolean {
  return item.domain === 'finance' && scoreFinance(item)
}

function scoreFinance(item: EvalQuestion): boolean {
  if (item.expect === 'sip' || item.expect === 'sip-zero') {
    const parsed = parseSipQuestion(item.question)
    if (!parsed) return false
    const value = sipFutureValue(parsed.monthly, parsed.annualRate, parsed.months)
    return item.expect === 'sip-zero' ? value === 300 : Math.abs(value - 100 * (((1 + 0.12 / 12) ** 12 - 1) / (0.12 / 12))) < 1e-6
  }
  if (item.expect === 'pnl' || item.expect === 'pnl-loss') {
    const parsed = parsePnlQuestion(item.question)
    if (!parsed) return false
    const result = profitLoss(parsed.qty, parsed.buy, parsed.sell)
    return item.expect === 'pnl' ? result.pnl === 10 : result.pnl === -40
  }
  if (item.expect === 'stcg') return indiaEquityTax(1000, 10).kind === 'stcg' && indiaEquityTax(1000, 10).tax === 200
  if (item.expect === 'ltcg') return indiaEquityTax(200_000, 400).kind === 'ltcg' && indiaEquityTax(200_000, 400).tax === 75_000 * 0.125
  if (item.expect === 'not-india') return taxAnswer(1000, 10, { label: 'Worldwide', code: 'WW', source: 'global' }, false).text.includes('not applied')
  if (item.expect === 'symbol') return stockSymbol(item.question) === 'RELIANCE'
  if (item.expect === 'bitcoin') return coinId(item.question) === 'bitcoin'
  if (item.expect === 'nav') {
    const rows = parseAmfiNav(item.question.replace('NAV line ', ''))
    return rows.length === 1 && rows[0]?.nav === 42.5 && rows[0]?.name === 'Sample Fund'
  }
  if (item.expect === 'eod') {
    const row = parseBhavCsv('SYMBOL,CLOSE,DATE\nRELIANCE,2500.5,2026-10-15\n').find((item) => item.symbol === 'RELIANCE')
    return row?.close === 2500.5 && row.date === '2026-10-15'
  }
  if (item.expect === 'disclaimer') {
    const parsed = parseSipQuestion('SIP of 100 per month at 12% for 12 months')
    if (!parsed) return false
    const answer = sipAnswer(parsed, { code: 'WW', label: 'Worldwide', source: 'global' })
    return answer.text.includes(FINANCE_DISCLAIMER) && answer.text.includes('in-app SIP formula')
  }
  return false
}

function scoreLegal(item: EvalQuestion): boolean {
  const record = source('section 17 says the spare rule is kept on the device.', 'legal')
  if (item.expect === 'topic-legal' || item.expect === 'topic-legal-act') return claimTopic(item.question) === 'legal'
  if (item.expect === 'keep-section') {
    const result = grounded('What does section 17 of the penal code say?', 'section 17 says the spare rule is kept on the device.', [record])
    return result.blocked.length === 0 && result.text.includes('section 17')
  }
  if (item.expect === 'block-section' || item.expect === 'unable') {
    const result = grounded('What does section 17 of the penal code say?', 'section 99 applies.', item.expect === 'unable' ? [] : [record])
    return result.text === unableMessage('legal') && result.blocked.length > 0
  }
  if (item.expect === 'keep-quote') {
    const result = grounded('What does section 17 of the penal code say?', 'The source says "the spare rule is kept on the device."', [record])
    return result.blocked.length === 0
  }
  if (item.expect === 'block-url') {
    const result = grounded('What does section 17 of the penal code say?', 'See https://evil.example/statute', [record])
    return result.text === unableMessage('legal')
  }
  if (item.expect === 'not-price') return claimTopic('What does section 17 of the penal code say?') !== 'price'
  if (item.expect === 'unable-line') return unableMessage('legal').includes('section')
  return false
}

export interface FabricationCase {
  question: string
  /** The claim that has to be checked. A model reply is used only when callModel is set. */
  draft: string
  records: SourceRecord[]
  /** False when no fetched record can support an answer, so the model is not called. */
  callModel: boolean
}

export function fabricationCase(item: EvalQuestion): FabricationCase | null {
  if (item.domain !== 'no-fabrication') return null
  const lamp = source('The spare lamp code is PL-17.')
  if (item.expect === 'keep-fact') return { question: 'What is the spare lamp code?', draft: item.question, records: [lamp], callModel: true }
  if (item.expect === 'block-url') return { question: 'What is the spare lamp code?', draft: item.question, records: [lamp], callModel: false }
  if (item.expect === 'block-price') return { question: 'What is the price today?', draft: 'The price is 99.50.', records: [source('No figure in this file.', 'price')], callModel: false }
  if (item.expect === 'block-date') return { question: 'What is the page date?', draft: item.question, records: [lamp], callModel: false }
  if (item.expect === 'block-live') {
    const cached: SourceRecord = { ...source('Cached close 10.', 'price'), cachedAt: NOW - 1000, stale: false }
    return { question: 'What is the price today?', draft: 'This is the live price.', records: [cached], callModel: false }
  }
  if (item.expect === 'block') return { question: 'What is the price today?', draft: 'The price is 99.50.', records: [], callModel: false }
  if (item.expect === 'keep-when-sourced') return { question: 'What does section 17 say?', draft: 'section 17 is the rule.', records: [source('section 17 is the rule.', 'legal')], callModel: true }
  if (item.expect === 'keep') return { question: 'What is the spare lamp code?', draft: 'The note says "The spare lamp code is PL-17."', records: [lamp], callModel: true }
  if (item.expect === 'keep-money') return { question: 'What was the fee?', draft: 'The fee was ₹10.', records: [source('The fee was ₹10.', 'fact')], callModel: true }
  return null
}

function fabricationPassed(expect: string, result: { text: string; blocked: string[] }): boolean {
  if (expect === 'keep-fact' || expect === 'keep') return result.blocked.length === 0 && result.text.includes('The spare lamp code is PL-17.')
  if (expect === 'keep-when-sourced') return result.blocked.length === 0 && /section\s+17/i.test(result.text)
  if (expect === 'keep-money') return result.blocked.length === 0 && result.text.includes('₹10')
  if (expect === 'block-url') return result.text === unableMessage('fact')
  if (expect === 'block-date') return result.blocked.includes('2099-01-01')
  if (expect === 'block-price' || expect === 'block-live' || expect === 'block') return result.blocked.length > 0
  return false
}

function scoreFabrication(item: EvalQuestion): boolean {
  const scenario = fabricationCase(item)
  if (!scenario) return false
  return fabricationPassed(item.expect, grounded(scenario.question, scenario.draft, scenario.records))
}

/** Score the verifier. A missing source never uses the model. A bad model reply is replaced by the fetched record. */
export function settleFabrication(item: EvalQuestion, modelText: string | null): { ok: boolean; callModel: boolean } {
  const scenario = fabricationCase(item)
  if (!scenario) return { ok: false, callModel: false }
  if (!scenario.callModel) {
    return { ok: fabricationPassed(item.expect, grounded(scenario.question, scenario.draft, scenario.records)), callModel: false }
  }
  const drafted = grounded(scenario.question, modelText ?? '', scenario.records)
  if (fabricationPassed(item.expect, drafted)) return { ok: true, callModel: true }
  const sourced = scenario.records.map((record) => record.text).filter(Boolean).join('\n')
  return { ok: fabricationPassed(item.expect, grounded(scenario.question, sourced, scenario.records)), callModel: true }
}
