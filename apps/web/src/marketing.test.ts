import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { licenceTerms, PRICING_NOTICE, termPrice } from './pricing-config.ts'
import { leadWithCode, websiteAgentState } from './marketing/site-agents.ts'

const root = new URL('.', import.meta.url).pathname

function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) filesUnder(path, out)
    else if (/\.(tsx?|css|html)$/.test(name) && !name.endsWith('.test.ts')) out.push(path)
  }
  return out
}

const pageText = [
  ...filesUnder(join(root, 'marketing')),
  join(root, 'pages.tsx'),
  join(root, 'App.tsx'),
  join(root, 'landing.tsx'),
  join(root, '../index.html'),
].filter((path) => {
  try { statSync(path); return true } catch { return false }
}).map((path) => readFileSync(path, 'utf8')).join('\n')

const banned = [
  /lokmind/i,
  /iokmind/i,
  /\$0\.99/,
  /\$1\.59/,
  /\$3\.59/,
  /\b0\.99\b/,
  /\b1\.59\b/,
  /\b3\.59\b/,
  /Linus Vance/,
  /Elena Rostova/,
  /Marcus Thorne/,
  /Kenji Sato/,
  /Aria Vance/,
  /452 Townsend/,
  /0\.42\s*ms/i,
  /Zero bytes/i,
  /air-gapped/i,
  /Tree-sitter/i,
  /Whisper/i,
  /Wireshark/i,
  /SOC\s*2/i,
  /click-spin/,
  /Qwen2\.5/,
  /Gemma 4/,
]

test('pricing config has no amounts', () => {
  assert.equal(PRICING_NOTICE, 'Pricing coming soon')
  assert.ok(licenceTerms.length >= 4)
  for (const term of licenceTerms) {
    assert.equal(term.amount, null)
    assert.equal(termPrice(term), PRICING_NOTICE)
  }
})

test('the website ships Code and marks every other agent coming soon', () => {
  assert.equal(websiteAgentState('code'), 'ready')
  for (const id of ['general', 'assistant', 'marine', 'pilot', 'construction']) {
    assert.equal(websiteAgentState(id), 'coming soon')
  }
  assert.deepEqual(leadWithCode([{ id: 'general' }, { id: 'code' }, { id: 'assistant' }]).map((agent) => agent.id), ['code', 'general', 'assistant'])

  const read = (name: string) => readFileSync(join(root, 'marketing', name), 'utf8')
  const agentsSrc = read('agents.tsx')
  const generalSrc = read('general-agent.tsx')
  const summarySrc = read('agent-summary.tsx')
  const docsSrc = read('docs.tsx')
  const featuresSrc = read('features.tsx')
  const homeSrc = read('home.tsx')
  const codeSrc = read('code-agent.tsx')

  for (const src of [agentsSrc, generalSrc, summarySrc, docsSrc, featuresSrc]) {
    assert.doesNotMatch(src, /Beta/)
    assert.doesNotMatch(src, /agent\.status/)
  }
  assert.doesNotMatch(generalSrc, /Available/)
  assert.doesNotMatch(summarySrc, /Available/)
  assert.match(generalSrc, /Coming soon/)
  assert.match(agentsSrc, /Coming soon/)
  assert.match(agentsSrc, /websiteAgentState/)
  assert.match(homeSrc, /<h1[\s\S]*?Code runs on your laptop/)
  assert.doesNotMatch(homeSrc, /General, Code, and Assistant are in this build/)
  assert.doesNotMatch(codeSrc, /pill">Beta/)
  assert.match(codeSrc, /pill">Available/)
})

test('marketing pages omit placeholder brand, prices, and fake names', () => {
  const hits = banned.filter((pattern) => pattern.test(pageText)).map(String)
  assert.deepEqual(hits, [])
  assert.match(pageText, /Pricing coming soon/)
  assert.match(pageText, /Pip/)
  assert.match(pageText, /Qwen 4B/)
  assert.doesNotMatch(pageText, /Qwen 2B|Qwen 9B/)
  assert.match(pageText, /Synap\.surf/)
})
