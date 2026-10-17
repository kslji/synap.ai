import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanCpuName, formatContextTokens, formatPromptCache, formatRamGb } from './hardware-label.js'

test('processor names drop marks and redundant words', () => {
  assert.equal(cleanCpuName('Intel(R) Xeon(R) Processor'), 'Intel Xeon')
  assert.equal(cleanCpuName('Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz'), 'Intel Core i7-9750H')
  assert.equal(cleanCpuName('Intel(R) Xeon(R) CPU E5-2676 v3 @ 2.40GHz'), 'Intel Xeon E5-2676 v3')
  assert.equal(cleanCpuName('Apple M2'), 'Apple M2')
  assert.equal(cleanCpuName('Apple M2 Pro'), 'Apple M2 Pro')
  assert.equal(cleanCpuName('AMD Ryzen 7 5800H with Radeon Graphics'), 'AMD Ryzen 7 5800H')
})

test('hardware values stay short and measured', () => {
  assert.equal(formatRamGb(15.6), '15.6 GB')
  assert.equal(formatRamGb(16), '16 GB')
  assert.equal(formatContextTokens(16384), '16K tokens')
  assert.equal(formatContextTokens(8192), '8K tokens')
  assert.equal(formatPromptCache(512), '512 MB')
  assert.equal(formatPromptCache(0), 'Off')
})
