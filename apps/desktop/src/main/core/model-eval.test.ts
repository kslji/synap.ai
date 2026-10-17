import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { evalQuestions, fabricationCase, financeAnswerOk, settleFabrication } from './step11-questions.js'
import {
  accuracyFloor,
  choiceLabels,
  coverSkips,
  evalContextTokens,
  fabricationPrompt,
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
} from './model-eval.js'

const thresholds = { minAccuracy: 0.5, minNoFabrication: 0.4 }

test('subset stays inside 30 to 50 and keeps the required domains', () => {
  const all = evalQuestions()
  assert.equal(all.length, 101)
  const subset = selectModelEvalQuestions('subset', all)
  assert.ok(subset.length >= 30 && subset.length <= 50)
  for (const domain of ['coding', 'splitting', 'run-fix', 'finance', 'no-fabrication']) {
    assert.ok(subset.some((row) => row.domain === domain))
  }
  assert.equal(subset.filter((row) => row.domain === 'no-fabrication').length, 10)
  assert.equal(selectModelEvalQuestions('full', all).length, 101)
})

test('a reply scores only when the first label matches', () => {
  const bank = evalQuestions()
  const command = bank.find((row) => row.domain === 'coding' && row.expect === 'allow')!
  const labels = choiceLabels(command, bank)
  assert.deepEqual(labels, ['allow', 'refuse'])
  assert.deepEqual(choiceLabels(bank.find((row) => row.expect === 'chat')!, bank), ['chat', 'edit', 'plan'])
  assert.ok(labels.includes('allow'))
  assert.equal(scoreModelLabel('allow', 'allow', labels).ok, true)
  assert.equal(scoreModelLabel('Allow.', 'allow', labels).ok, true)
  assert.equal(scoreModelLabel('refuse', 'allow', labels).ok, false)
  const prompt = modelEvalPrompt(evalQuestions()[0]!, labels)
  assert.ok(prompt.includes(evalQuestions()[0]!.question))
  assert.ok(prompt.startsWith('Reply with exactly one label'))
  assert.ok(labelGrammar(['allow', 'refuse']).includes('"allow"'))
})

test('finance labels stay a real choice and follow the question shape', () => {
  const bank = evalQuestions()
  const tax = bank.find((row) => row.id === 'q-finance-stcg')!
  assert.deepEqual(choiceLabels(tax, bank), ['stcg', 'ltcg', 'not-india'])
  const close = bank.find((row) => row.id === 'q-finance-eod-fixture')!
  assert.deepEqual(choiceLabels(close, bank), ['eod', 'not-india', 'symbol'])
  const prompt = modelEvalPrompt(bank.find((row) => row.domain === 'splitting' && row.expect === 'chat')!, ['chat', 'edit', 'plan'])
  assert.match(prompt, /quick fix/)
  assert.match(prompt, /two different files/)
})

test('no-fabrication scores the verifier, including a model reply that invents a figure', () => {
  const bank = evalQuestions().filter((row) => row.domain === 'no-fabrication')
  assert.equal(bank.length, 10)
  const invented = 'The spare lamp code is PL-99. Price 99.50. https://evil.example/nope on 2099-01-01.'
  for (const item of bank) {
    const scenario = fabricationCase(item)
    assert.ok(scenario)
    assert.equal(settleFabrication(item, invented).ok, true, item.id)
    if (!scenario.callModel) assert.equal(settleFabrication(item, null).callModel, false)
  }
  const keep = bank.find((row) => row.expect === 'keep-fact')!
  assert.match(fabricationPrompt('What is the spare lamp code?', ['The spare lamp code is PL-17.']), /only the source/)
  assert.equal(fabricationCase(keep)?.callModel, true)
})

test('summary records accuracy, no-fabrication, speed, and time to first token', () => {
  const summary = summarizeAnswers([
    { id: 'a', domain: 'coding', ok: true, label: 'allow', ttftMs: 100, tokens: 2, genMs: 200 },
    { id: 'b', domain: 'no-fabrication', ok: false, label: 'keep', ttftMs: 300, tokens: 2, genMs: 200 },
    { id: 'c', domain: 'no-fabrication', ok: true, label: 'block', ttftMs: 500, tokens: 1, genMs: 100 },
  ])
  assert.equal(summary.accuracy, 2 / 3)
  assert.equal(summary.noFabrication.accuracy, 0.5)
  assert.equal(summary.ttftMs, 300)
  assert.ok(summary.tokensPerSec != null && summary.tokensPerSec > 0)
  assert.equal(passesThresholds(summary.accuracy, summary.noFabrication.accuracy, thresholds).ok, true)
  assert.equal(passesThresholds(0.2, 0.5, thresholds).ok, false)
})

test('thresholds reject values outside 0 to 1', () => {
  assert.throws(() => loadThresholds({}), /minAccuracy/)
  assert.deepEqual(loadThresholds({ minAccuracy: 0.5, minNoFabrication: 0.4 }), thresholds)
  assert.throws(() => loadThresholds({ minAccuracy: 2, minNoFabrication: 0.4 }), /between/)
})

test('context and RAM follow the tier rules', () => {
  assert.equal(evalContextTokens(4), 8192)
  assert.equal(evalContextTokens(8), 8192)
  assert.equal(evalContextTokens(16), 16384)
  assert.equal(ramAllows(6, 4), true)
  assert.equal(ramAllows(3, 8), false)
  assert.equal(ramAllows(null, 16), true)
  assert.equal(mmprojRamAllows(6, 4, 668_227_264), true)
  assert.equal(tokenizerUrl('https://example.test/Qwen3.5-2B-Q4_K_M.gguf'), 'https://example.test/tokenizer.json')
})

test('the release gate reads a saved full run when this machine skipped a model', () => {
  const skipped: MeasuredModel = {
    id: 'qwen3.5-9b-q4_k_m', sha256: 'abc', measured: false, reason: 'insufficient-ram',
    accuracy: null, noFabrication: null, tokensPerSec: null, ttftMs: null, peakRssMb: null, questions: 0,
  }
  const saved: MeasuredModel = {
    id: 'qwen3.5-9b-q4_k_m', sha256: 'abc', measured: true, accuracy: 0.6, noFabrication: 0.5,
    tokensPerSec: 8, ttftMs: 400, peakRssMb: 9000, questions: 101,
    mmproj: { measured: true, sha256: 'def', peakRssMb: 9800, replied: true },
  }
  const small: MeasuredModel = {
    id: 'qwen3.5-2b-q4_k_m', sha256: 'aaa', measured: true, accuracy: 0.7, noFabrication: 0.6,
    tokensPerSec: 20, ttftMs: 200, peakRssMb: 1800, questions: 101,
    mmproj: { measured: true, sha256: 'bbb', peakRssMb: 2400, replied: true },
  }
  const mid: MeasuredModel = { ...small, id: 'qwen3.5-4b-q4_k_m', sha256: 'ccc' }
  const covered = coverSkips([small, mid, skipped], [saved])
  assert.equal(releaseGate(covered, thresholds).ok, true)
  assert.equal(releaseGate(coverSkips([skipped], []), thresholds).ok, false)
})

test('finance answers are the in-app formula, not a model label', () => {
  const finance = evalQuestions().filter((row) => row.domain === 'finance')
  assert.equal(finance.length, 12)
  assert.equal(finance.every((row) => financeAnswerOk(row)), true)
  const disclaimer = finance.find((row) => row.expect === 'disclaimer')!
  assert.equal(financeAnswerOk(disclaimer), true)
})

test('the committed real-model floors do not sit under a measured miss', () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../../../../harness/baselines/model-eval.json')
  const saved = loadThresholds(JSON.parse(readFileSync(path, 'utf8')))
  assert.equal(saved.minNoFabrication, 1)
  assert.equal(saved.minAccuracy, 1)
  assert.equal(accuracyFloor(saved, 'subset'), 1)
  assert.equal(accuracyFloor(saved, 'full'), saved.fullMinAccuracy)
  assert.equal(passesThresholds(1, 1, saved, 'subset').ok, true)
  assert.equal(passesThresholds(0.99, 1, saved, 'subset').ok, false)
  assert.equal(passesThresholds(1, 0.6, saved, 'subset').ok, false)
})
