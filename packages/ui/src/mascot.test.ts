import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MASCOT_MANIFEST,
  MOUTH_PATH,
  blinkDelayMs,
  pickClick,
  poseAt,
  shouldAnimate,
  stillPose,
} from './mascot.ts'

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

test('reduced motion and the animate setting both hold a still pose', () => {
  assert.equal(shouldAnimate(true, false), true)
  assert.equal(shouldAnimate(true, true), false)
  assert.equal(shouldAnimate(false, false), false)
  const still = stillPose()
  assert.equal(still.scaleX, 1)
  assert.equal(still.scaleY, 1)
  assert.equal(still.mouth, 'smile')
  assert.equal(still.eyeOpen, 1)
})

test('idle breathes and a blink shuts the eyes', () => {
  const rest = poseAt('idle', 0, false)
  const lifted = poseAt('idle', 900, false)
  assert.ok(lifted.y < rest.y)
  assert.notEqual(lifted.scaleY, rest.scaleY)
  const shut = poseAt('idle', 900, true)
  assert.ok(shut.eyeOpen < 0.2)
})

test('thinking looks up, searching scans, success squashes, error frowns', () => {
  const think = poseAt('thinking', 550, false)
  assert.ok(think.pupilY < 0)
  assert.equal(think.mouth, 'flat')
  const left = poseAt('searching', 0, false)
  const right = poseAt('searching', 175, false)
  assert.ok(right.pupilX > left.pupilX)
  const squash = poseAt('success', 40, false)
  const stretch = poseAt('success', 360, false)
  assert.ok(squash.scaleX > squash.scaleY)
  assert.ok(stretch.scaleY > stretch.scaleX)
  assert.equal(poseAt('error', 100, false).mouth, 'frown')
})

test('tap reactions are a hop, a spin, and a wink', () => {
  const hop = poseAt('click-hop', 40, false)
  assert.ok(hop.scaleX > hop.scaleY)
  const spun = poseAt('click-spin', 450, false)
  assert.ok(spun.rotate > 100)
  const wink = poseAt('click-spark', 300, false)
  assert.equal(wink.wink, true)
  assert.equal(poseAt('click-spark', 800, false).wink, false)
})

test('arrive, guiding, and notification each move, and an unknown id stays still', () => {
  const arrived = poseAt('arrive', 0, false)
  assert.ok(arrived.y > poseAt('arrive', 1500, false).y)
  assert.notEqual(poseAt('guiding', 200, false).pupilX, 0)
  assert.equal(poseAt('notification', 200, false).mouth, 'open')
  const unknown = poseAt('nope', 10, true)
  assert.equal(unknown.eyeOpen, 0.08)
  assert.equal(unknown.mouth, 'smile')
  const landed = poseAt('success', 700, false)
  assert.ok(landed.scaleX > 1)
})

test('mouth paths differ and blink spacing stays in range', () => {
  const paths = new Set(Object.values(MOUTH_PATH))
  assert.equal(paths.size, 5)
  assert.ok(blinkDelayMs(0) >= 1800)
  assert.ok(blinkDelayMs(0.999) <= 5000)
  assert.ok(blinkDelayMs(-0.2) >= 1800)
})
