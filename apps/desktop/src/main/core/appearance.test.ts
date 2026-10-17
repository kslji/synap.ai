import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanMascotColor, cleanMascotName, DEFAULT_MASCOT_COLOR, DEFAULT_MASCOT_NAME } from './appearance.js'

test('the default mascot name is Surf', () => {
  assert.equal(DEFAULT_MASCOT_NAME, 'Surf')
  assert.equal(cleanMascotName(''), 'Surf')
  assert.equal(cleanMascotName('  Pip  '), 'Pip')
  assert.equal(cleanMascotName(null), 'Surf')
  assert.equal(cleanMascotName('Surf Bot'), 'Surf Bot')
})

test('mascot colour is a saved hex and anything else stays orange', () => {
  assert.equal(cleanMascotColor('#3B82F6'), '#3b82f6')
  assert.equal(cleanMascotColor('#f2740f'), DEFAULT_MASCOT_COLOR)
  assert.equal(cleanMascotColor('orange'), DEFAULT_MASCOT_COLOR)
  assert.equal(cleanMascotColor('#fff'), DEFAULT_MASCOT_COLOR)
  assert.equal(cleanMascotColor(undefined), DEFAULT_MASCOT_COLOR)
})
