/**
 * The finance maths survived the web purge and stayed network-free.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  coinId,
  indiaEquityTax,
  parseAmfiNav,
  parseBhavCsv,
  parsePnlQuestion,
  parseSipQuestion,
  profitLoss,
  sipFutureValue,
  stockSymbol,
  xirr,
} from './finance-maths.js'

test('the in-app formulas answer the money questions', () => {
  assert.equal(sipFutureValue(100, 0, 12), 1200)
  const i = 0.12 / 12
  assert.ok(Math.abs(sipFutureValue(100, 0.12, 12) - 100 * (((1 + i) ** 12 - 1) / i)) < 1e-6)
  assert.equal(profitLoss(2, 10, 15).pnl, 10)
  assert.equal(profitLoss(4, 20, 10).pnl, -40)
  assert.equal(indiaEquityTax(1000, 10).kind, 'stcg')
  assert.equal(indiaEquityTax(1000, 10).tax, 200)
  assert.equal(indiaEquityTax(200_000, 400).tax, 75_000 * 0.125)
  const flows = [{ amount: -1000, date: '2024-01-01' }, { amount: 1100, date: '2025-01-01' }]
  const rate = xirr(flows)
  assert.ok(rate != null && Math.abs(rate - 0.1) < 1e-3)
})

test('the question parsers and file parsers still work', () => {
  assert.deepEqual(parseSipQuestion('SIP of 100 per month at 12% for 12 months'), { monthly: 100, annualRate: 0.12, months: 12 })
  assert.deepEqual(parsePnlQuestion('Bought at 10 and sold at 15 with 2 shares'), { qty: 2, buy: 10, sell: 15 })
  assert.equal(stockSymbol('What is the price of "RELIANCE" today?'), 'RELIANCE')
  assert.equal(coinId('What is the bitcoin price?'), 'bitcoin')
  const nav = parseAmfiNav('120503;INF1;INF2;Sample Fund;42.5;16-Oct-2026')
  assert.equal(nav.length, 1)
  assert.equal(nav[0]?.nav, 42.5)
  assert.equal(nav[0]?.name, 'Sample Fund')
  const bhav = parseBhavCsv('SYMBOL,CLOSE,DATE\nRELIANCE,2500.5,2026-10-15\n')
  assert.equal(bhav[0]?.close, 2500.5)
})

test('the module reaches no network and pulls in no web types', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'finance-maths.ts'), 'utf8')
  for (const dead of ['fetch(', 'politeFetch', 'jszip', 'JSZip', './http', './region', './types', 'Citation', 'https://']) {
    assert.equal(src.includes(dead), false, `finance-maths.ts must not reference ${dead}`)
  }
})
