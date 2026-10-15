import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeFileCapBytes, laptopRamClass, ramTierForFile } from './code-ram.js'

test('system RAM picks the Code file cap', () => {
  assert.equal(laptopRamClass(3.8), 4)
  assert.equal(laptopRamClass(7.2), 4)
  assert.equal(laptopRamClass(7.3), 8)
  assert.equal(laptopRamClass(14.9), 8)
  assert.equal(laptopRamClass(15), 16)
  assert.equal(laptopRamClass(15.6), 16)
  assert.equal(laptopRamClass(30.9), 16)
  assert.equal(laptopRamClass(31), 32)
  assert.equal(codeFileCapBytes(3.8), 2_000_000_000)
  assert.equal(codeFileCapBytes(8), 3_000_000_000)
  assert.equal(codeFileCapBytes(16), 4_000_000_000)
  assert.equal(codeFileCapBytes(32), 8_000_000_000)
  assert.equal(ramTierForFile(1_574_961_408), 4)
  assert.equal(ramTierForFile(3_106_738_272), 16)
  assert.equal(ramTierForFile(3_525_956_768), 16)
  assert.equal(ramTierForFile(4_590_807_392), 32)
  assert.equal(ramTierForFile(7_121_861_440), 32)
  assert.equal(ramTierForFile(7_458_301_152), 32)
})
