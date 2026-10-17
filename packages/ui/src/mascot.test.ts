import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  advance,
  bodyPath,
  bodySpread,
  createSim,
  DEFAULT_BLOB_COLOR,
  FILE_POSES,
  gazeTarget,
  markSvg,
  paletteFor,
  parseHex,
  poseFor,
  resolveBlobState,
} from './blob.ts'
import { MASCOT_MANIFEST, motionScale, pickClick, shouldAnimate } from './mascot.ts'

test('mascot stays silent and does not ship reference clips', () => {
  assert.equal(MASCOT_MANIFEST.audio, false)
  assert.equal(MASCOT_MANIFEST.shipReferenceClips, false)
  assert.equal(MASCOT_MANIFEST.engine, 'svg')
  assert.deepEqual(Object.keys(MASCOT_MANIFEST.states), ['idle', 'searching', 'thinking', 'success', 'error'])
})

test('a tap picks one of the three reactions from the seed', () => {
  assert.equal(pickClick(0).id, 'click-hop')
  assert.equal(pickClick(0.5).id, 'click-spin')
  assert.equal(pickClick(0.99).id, 'click-spark')
  assert.equal(MASCOT_MANIFEST.clicks.length, 3)
})

test('the animate setting pauses the loop and reduced motion only shrinks it', () => {
  assert.equal(shouldAnimate(true, false), true)
  assert.equal(shouldAnimate(true, true), true)
  assert.equal(shouldAnimate(false, false), false)
  assert.equal(motionScale(false), 1)
  assert.equal(motionScale(true), 0.3)
  const full = bodySpread('idle', 0.8, false)
  const quiet = bodySpread('idle', 0.8, true)
  assert.ok(quiet < full)
})

test('the five reference poses keep their eye numbers', () => {
  assert.equal(FILE_POSES.thinking.erl, 78)
  assert.equal(FILE_POSES.thinking.tilt, -5)
  assert.equal(FILE_POSES.working.spd, 4)
  assert.equal(FILE_POSES.happy.ehl, 1.2)
  assert.equal(FILE_POSES.oops.sy0, 0.94)
  assert.equal(poseFor('error').erl, FILE_POSES.oops.erl)
  assert.equal(poseFor('success').ehl, FILE_POSES.happy.ehl)
})

test('eyes follow the task: up, across, down the page, and drooping', () => {
  assert.ok(gazeTarget('thinking', 0, null).y < -0.7)
  assert.ok(gazeTarget('thinking', 0, null).x < -0.5)
  const left = gazeTarget('searching', 0.209, null).x
  const right = gazeTarget('searching', 0.209 + Math.PI / 7.5, null).x
  assert.ok(left > 0.9)
  assert.ok(right < -0.9)
  const top = gazeTarget('reading', 0, null)
  const lower = gazeTarget('reading', 2.1, null)
  assert.ok(top.y < lower.y)
  assert.ok(top.x < 0)
  assert.equal(gazeTarget('oops', 1, null).y, 0.85)
  assert.ok(gazeTarget('typing', 0, null).y > 0.8)
  assert.ok(gazeTarget('permission', 3, { x: 1, y: 1 }).x < 0.5)
})

test('writing follows a caret and a hop only happens when motion is allowed', () => {
  const sim = createSim()
  const draw = advance(sim, 0.4, 0, { state: 'writing', reduced: false, variant: 'avatar', caret: 1, snap: true, random: () => 0.2 })
  assert.match(draw.eyeL, /translate\(/)
  assert.ok(gazeTarget('writing', 0.99, null).x > 0.5)
  const happy = createSim()
  advance(happy, 1, 0.016, { state: 'happy', reduced: false, variant: 'full', random: () => 0.3 })
  assert.ok(happy.hv > 0 || happy.sparks.length > 0)
  const still = createSim()
  advance(still, 1, 0.016, { state: 'happy', reduced: true, variant: 'full', random: () => 0.3 })
  assert.equal(still.sparks.length, 0)
  assert.equal(still.hv, 0)
})

test('three fast pokes spin the eyes and one poke squashes', () => {
  const sim = createSim()
  advance(sim, 1, 0.016, { state: 'idle', reduced: false, variant: 'full', poke: true, random: () => 0.2 })
  assert.ok(sim.sq < 0)
  advance(sim, 1.2, 0.016, { state: 'idle', reduced: false, variant: 'full', poke: true, random: () => 0.2 })
  advance(sim, 1.4, 0.016, { state: 'idle', reduced: false, variant: 'full', poke: true, random: () => 0.2 })
  assert.ok(sim.dizzyUntil > 1.4)
  const spun = advance(sim, 1.5, 0.016, { state: 'idle', reduced: false, variant: 'full', random: () => 0.2 })
  assert.match(spun.eyeL, /rotate\([^)]*[1-9]/)
})

test('colour keeps the orange stops and lightens the eyes on a dark body', () => {
  const orange = paletteFor(DEFAULT_BLOB_COLOR)
  assert.equal(orange.top, '#ffc27a')
  assert.equal(orange.bottom, '#f2740f')
  assert.equal(orange.eye, '#2b1204')
  const dark = paletteFor('#111111')
  assert.equal(dark.eye, '#fff4e8')
  assert.notEqual(dark.bottom, orange.bottom)
  const blue = paletteFor('#3b82f6')
  const top = parseHex(blue.top)!
  const bottom = parseHex(blue.bottom)!
  assert.ok((top.r + top.g + top.b) > (bottom.r + bottom.g + bottom.b))
  assert.equal(paletteFor('nope').bottom, DEFAULT_BLOB_COLOR)
})

test('the body path closes and the static mark is the orange blob', () => {
  const path = bodyPath([[0, 0], [10, 0], [10, 10], [0, 10], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [8, 8]])
  assert.ok(path.startsWith('M'))
  assert.ok(path.endsWith('Z'))
  assert.ok(path.includes('C'))
  const svg = markSvg()
  assert.match(svg, /#ffc27a/)
  assert.match(svg, /#f2740f/)
  assert.doesNotMatch(svg, /<video|star-surf|webm/i)
})

test('real cues outrank idle, and offline stays calm rather than an error', () => {
  assert.equal(resolveBlobState({ task: 'oops', permission: true, benchmark: true }), 'oops')
  assert.equal(resolveBlobState({ task: 'idle', permission: true, benchmark: true }), 'permission')
  assert.equal(resolveBlobState({ task: 'searching', benchmark: true }), 'benchmark')
  assert.equal(resolveBlobState({ task: 'searching' }), 'searching')
  assert.equal(resolveBlobState({ task: 'answering' }), 'writing')
  assert.equal(resolveBlobState({ task: 'idle', typing: true, offline: true, sleepy: true }), 'typing')
  assert.equal(resolveBlobState({ task: 'idle', offline: true, sleepy: true }), 'offline')
  assert.equal(resolveBlobState({ task: 'idle', sleepy: true }), 'sleepy')
  assert.equal(resolveBlobState({ task: 'error' }), 'oops')
  assert.notEqual(resolveBlobState({ task: 'idle', offline: true }), 'oops')
})
