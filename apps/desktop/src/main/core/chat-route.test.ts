import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handle } from './calculator.worker.js'
import {
  DEVICE_REPLY,
  FOLDER_PROMPT,
  OFFLINE_WEB_NOTE,
  mathJob,
  phraseMath,
  routeTurn,
  wantsDeviceControl,
  withWebBanner,
} from './chat-route.js'

function calc(expression: string): string {
  const ran = handle({ id: 1, kind: 'calc', expression })
  assert.equal(ran.ok, true)
  return ran.ok ? ran.result : ''
}

test('everyday questions: what is 2+2 and similar sums use the calculator', () => {
  const questions = ['what is 2+2', 'what 2+2', "what's 2+2?", 'whats 2+2', 'how much is 2 + 2', 'calculate 2 + 2', '2+2']
  for (const question of questions) {
    const plan = routeTurn({ text: question, webChip: true, online: true, offlineOnly: false, hasFolder: false })
    assert.equal(plan.kind, 'math', question)
    assert.equal(plan.math?.kind, 'calc')
    if (plan.math?.kind === 'calc') assert.equal(plan.math.expression, '2+2')
    assert.equal(calc(plan.math?.kind === 'calc' ? plan.math.expression : ''), '4')
    assert.doesNotMatch(phraseMath('2 + 2', '4', 'I think it might be five.'), /Unable to find|worldwide sources/)
  }
})

test('what 2+2 reaches the calculator and the phrased answer is 4', () => {
  for (const question of ['what 2+2', 'what is 2+2', "what's 2+2?", '2+2', 'calculate 2 + 2']) {
    const job = mathJob(question)
    assert.equal(job?.kind, 'calc', question)
    assert.equal(job && job.kind === 'calc' ? job.expression : '', '2+2')
    const result = calc('2+2')
    assert.equal(result, '4')
    const phrase = phraseMath(job && job.kind === 'calc' ? job.label : '', result, 'I think it might be five.')
    assert.match(phrase, /=\s*4$/)
    assert.doesNotMatch(phrase, /Unable to find|worldwide sources/)
    const kept = phraseMath('2+2', result, '2 + 2 = 4.')
    assert.equal(kept, '2 + 2 = 4.')
  }
})

test('a bare what used to be rejected and is now a calculator expression', () => {
  const job = mathJob('what 2+2')
  assert.ok(job)
  assert.equal(routeTurn({ text: 'what 2+2', webChip: false, online: true, offlineOnly: false, hasFolder: false }).kind, 'math')
})

test('greetings and explanations stay with the model', () => {
  for (const question of ['hello', 'Explain what a variable is in one sentence.', 'What is the capital of France?', 'Write a JavaScript function that adds two numbers.']) {
    const plan = routeTurn({ text: question, webChip: false, online: true, offlineOnly: false, hasFolder: false })
    assert.equal(plan.kind, 'model', question)
    assert.equal(mathJob(question), null)
  }
})

test('web search runs only from the chip or a fresh question, and stays quiet offline', () => {
  const base = { online: true, offlineOnly: false, hasFolder: false }
  assert.equal(routeTurn({ ...base, text: 'hello', webChip: false }).kind, 'model')
  assert.equal(routeTurn({ ...base, text: 'hello', webChip: true }).kind, 'web')
  assert.equal(routeTurn({ ...base, text: 'What is the latest Electron release?', webChip: false }).kind, 'web')
  const offline = routeTurn({ text: 'hello', webChip: true, online: false, offlineOnly: true, hasFolder: false })
  assert.equal(offline.kind, 'model')
  assert.equal(offline.note, OFFLINE_WEB_NOTE)
})

test('the worldwide banner is added only when web pages were used', () => {
  assert.equal(withWebBanner('4', 'worldwide sources', false), '4')
  assert.match(withWebBanner('Electron is a framework. [S1]', 'worldwide sources', true), /^Showing results for worldwide sources\./)
})

test('device control is an honest refusal and file work asks for a folder', () => {
  assert.equal(wantsDeviceControl('take control of my laptop'), true)
  const device = routeTurn({ text: 'please control my computer and open Finder', webChip: false, online: true, offlineOnly: false, hasFolder: true })
  assert.equal(device.kind, 'device')
  assert.match(DEVICE_REPLY, /isn't available yet/)
  assert.doesNotMatch(DEVICE_REPLY, /I (opened|clicked|moved|typed)/)
  const folder = routeTurn({ text: 'edit the file in this project', webChip: false, online: true, offlineOnly: false, hasFolder: false })
  assert.equal(folder.kind, 'folder')
  assert.match(FOLDER_PROMPT, /open a project folder/i)
  const ready = routeTurn({ text: 'edit the file in this project', webChip: false, online: true, offlineOnly: false, hasFolder: true })
  assert.equal(ready.kind, 'model')
})
