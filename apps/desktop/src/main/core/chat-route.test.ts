import assert from 'node:assert/strict'
import { test } from 'node:test'
import { handle } from './calculator.worker.js'
import {
  DEVICE_REPLY,
  FOLDER_PROMPT,
  mathJob,
  phraseMath,
  routeTurn,
  wantsDeviceControl,
} from './chat-route.js'

const BIKE_WEEK = 'Chase and Rider can ride their bikes thrice a day for 5 days; but on two other days, they ride twice the times they do on usual days. How many times do they ride their bikes a week?'

function calc(expression: string): string {
  const ran = handle({ id: 1, kind: 'calc', expression })
  assert.equal(ran.ok, true)
  return ran.ok ? ran.result : ''
}

test('everyday questions: what is 2+2 and similar sums use the calculator', () => {
  const questions = ['what is 2+2', 'what 2+2', "what's 2+2?", 'whats 2+2', 'how much is 2 + 2', 'calculate 2 + 2', '2+2']
  for (const question of questions) {
    const plan = routeTurn({ text: question, hasFolder: false })
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
  assert.equal(routeTurn({ text: 'what 2+2', hasFolder: false }).kind, 'math')
})

test('a weekly ride word problem is one calculator expression', () => {
  const plan = routeTurn({ text: BIKE_WEEK, hasFolder: false })
  assert.equal(plan.kind, 'math')
  assert.equal(plan.math?.kind, 'calc')
  const expression = plan.math?.kind === 'calc' ? plan.math.expression : ''
  assert.equal(expression, '((3*5)+(3*2*2))*2')
  assert.equal(calc(expression), '54')
  const phrase = phraseMath(plan.math?.kind === 'calc' ? plan.math.label : '', '54', 'I counted 27.')
  assert.match(phrase, /54/)
  assert.doesNotMatch(phrase, /Unable to find|worldwide sources/)
  const one = 'Ada rides thrice a day for 5 days; on two other days, she rides twice the times she does on usual days. How many times does she ride?'
  const solo = mathJob(one)
  assert.equal(solo?.kind, 'calc')
  assert.equal(solo && solo.kind === 'calc' ? calc(solo.expression) : '', '27')
})

test('greetings and explanations stay with the model', () => {
  for (const question of ['hello', 'Explain what a variable is in one sentence.', 'What is the capital of France?', 'Write a JavaScript function that adds two numbers.']) {
    const plan = routeTurn({ text: question, hasFolder: false })
    assert.equal(plan.kind, 'model', question)
    assert.equal(mathJob(question), null)
  }
})

test('no turn routes to the web, not even one asking for fresh information', () => {
  for (const text of ['hello', 'What is the latest Electron release?', 'what is the price of diesel today', 'who won yesterday']) {
    const plan = routeTurn({ text, hasFolder: false })
    assert.equal(plan.kind, 'model', text)
    assert.notEqual(plan.kind, 'web' as never, text)
  }
})

test('device control is an honest refusal and file work asks for a folder', () => {
  const asks = [
    'control the laptop',
    'open files',
    'take control of the Mac or PC',
    'take control of my laptop',
    'please control my computer and open Finder',
  ]
  for (const text of asks) {
    assert.equal(wantsDeviceControl(text), true, text)
    for (const hasFolder of [false, true]) {
      const device = routeTurn({ text, hasFolder })
      assert.equal(device.kind, 'device', `${text} folder=${hasFolder}`)
    }
  }
  assert.match(DEVICE_REPLY, /isn't available yet/)
  assert.doesNotMatch(DEVICE_REPLY, /I (opened|clicked|moved|typed)/)
  const folder = routeTurn({ text: 'edit the file in this project', hasFolder: false })
  assert.equal(folder.kind, 'folder')
  assert.match(FOLDER_PROMPT, /open a project folder/i)
  const ready = routeTurn({ text: 'edit the file in this project', hasFolder: true })
  assert.equal(ready.kind, 'model')
  assert.equal(wantsDeviceControl('edit the file in this project'), false)
  assert.equal(wantsDeviceControl('open a project folder'), false)
})
