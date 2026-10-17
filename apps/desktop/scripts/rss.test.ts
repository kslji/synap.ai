import assert from 'node:assert/strict'
import { test } from 'node:test'
import { availableRamGb, readRssMb } from './rss.ts'

test('this process has a resident set', () => {
  const rss = readRssMb(process.pid)
  assert.ok(rss != null && rss > 1)
  if (process.platform === 'linux') {
    const free = availableRamGb()
    assert.ok(free != null && free > 0)
  }
})
