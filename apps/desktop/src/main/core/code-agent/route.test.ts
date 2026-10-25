import assert from 'node:assert/strict'
import { test } from 'node:test'
import { missingTargets, routeTask, type PlanFacts, type PlanStep } from './plan.js'

const facts: PlanFacts = {
  indexed: true,
  files: ['src/math.ts', 'src/app.ts', 'src/types.ts', 'src/render.ts'],
  symbols: [
    { name: 'add', qualified: 'src/math.ts:add', kind: 'function', path: 'src/math.ts' },
    { name: 'load', qualified: 'src/app.ts:load', kind: 'function', path: 'src/app.ts' },
    { name: 'paint', qualified: 'src/render.ts:paint', kind: 'function', path: 'src/render.ts' },
  ],
  edges: [],
}

test('one file and at most two symbols go straight to the loop', () => {
  assert.equal(routeTask('Rename add to sum in src/math.ts', facts), 'loop')
  assert.equal(routeTask('Fix the retry count in src/app.ts', facts), 'loop')
  assert.equal(routeTask('Rename add in src/math.ts', facts), 'loop')
})

test('two files, a new file, or a third symbol need the checklist', () => {
  assert.equal(routeTask('Rename add in src/math.ts and src/render.ts', facts), 'split')
  assert.equal(routeTask('Define LIMIT in a new file src/limits.ts', facts), 'split')
  assert.equal(routeTask('Rename add, load, and paint everywhere', facts), 'split')
  assert.equal(routeTask('Make the client retry', facts), 'split')
})

test('a file the checkpoint never wrote is named as missing', () => {
  const step: PlanStep = {
    id: 's1',
    goal: 'rename the caller',
    files: ['src/app.ts', 'src/render.ts'],
    symbols: [],
    depends_on: [],
    check: { kind: 'typecheck', command: '' },
    create: false,
  }
  const missing = missingTargets([step], [{ path: 'src/math.ts', status: 'applied' }], facts)
  assert.deepEqual(missing, ['src/app.ts', 'src/render.ts'])
})

test('a rejected or skipped write does not count, and a created file does', () => {
  const step: PlanStep = {
    id: 's1',
    goal: 'add the constant',
    files: [],
    symbols: ['LIMIT'],
    depends_on: [],
    check: { kind: 'typecheck', command: '' },
    create: true,
  }
  const index: PlanFacts = { ...facts, symbols: [{ name: 'LIMIT', qualified: 'src/limits.ts:LIMIT', kind: 'const', path: 'src/limits.ts' }] }
  assert.deepEqual(missingTargets([step], [{ path: 'src/limits.ts', status: 'applied' }], index), [])
  assert.deepEqual(missingTargets([step], [{ path: 'src/limits.ts', status: 'rejected' }], index), ['src/limits.ts'])
  assert.deepEqual(missingTargets([step], [], index, ['src/limits.ts']), ['src/limits.ts'])
})

test('a file the task only mentions is not a target until a step claims it', () => {
  const step: PlanStep = {
    id: 's1',
    goal: 'guard the divisor',
    files: ['src/math.ts'],
    symbols: [],
    depends_on: [],
    check: { kind: 'typecheck', command: '' },
    create: false,
  }
  // "leave src/render.ts alone" must not become a continuation step.
  assert.deepEqual(missingTargets([step], [{ path: 'src/math.ts', status: 'applied' }], facts), [])
  // A new file the task named, which nobody created, is still caught.
  assert.deepEqual(missingTargets([step], [{ path: 'src/math.ts', status: 'applied' }], facts, ['src/extra.ts']), ['src/extra.ts'])
})
