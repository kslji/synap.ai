import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanMascotColor, cleanMascotName, DEFAULT_MASCOT_COLOR, DEFAULT_MASCOT_NAME } from './appearance.js'

test('mascot name stays Surf Bot unless the person renames it', () => {
  assert.equal(cleanMascotName(''), DEFAULT_MASCOT_NAME)
  assert.equal(cleanMascotName('  Pip  '), 'Pip')
  assert.equal(cleanMascotName(null), DEFAULT_MASCOT_NAME)
})

test('mascot colour is a saved hex and anything else stays orange', () => {
  assert.equal(cleanMascotColor('#3B82F6'), '#3b82f6')
  assert.equal(cleanMascotColor('#f2740f'), DEFAULT_MASCOT_COLOR)
  assert.equal(cleanMascotColor('orange'), DEFAULT_MASCOT_COLOR)
  assert.equal(cleanMascotColor('#fff'), DEFAULT_MASCOT_COLOR)
  assert.equal(cleanMascotColor(undefined), DEFAULT_MASCOT_COLOR)
})
