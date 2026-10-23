/**
 * Item 7: web search is deleted, not disabled. These tests fail while any
 * part of the web-search stack still exists or is still wired in: the module
 * files, the IPC channels, the main service's search pipeline imports, the
 * chat router's web branch, and the eval bank's references to the search
 * connectors.
 *
 * Two modules that lived inside the web stack were kept and relocated next to
 * the rest of the local retrieval code, because they are not web search:
 * encrypted pack deltas (pack-delta.ts) and answer grounding (verify-answer.ts).
 * A third, citations.ts, turned out to be applied only to web answers, so it is
 * deleted with the rest.
 *
 * Every check here reads files, so it runs on any machine. The one check that
 * opens a real database lives in session-remove.test.ts.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { IPC } from '../../shared/ipc-contract'
import { evalQuestions } from './step11-questions.js'
import { selectModelEvalQuestions } from './model-eval.js'

const CORE = dirname(fileURLToPath(import.meta.url))

test('the web-search modules are gone from the tree', () => {
  for (const rel of [
    'search',
    'web-cache.ts',
    'web-cache.test.ts',
    'web-client.ts',
    'web.test.ts',
    'web-selftest.ts',
    'web-decision.ts',
    'dev-web-tools.ts',
    'dev-web-tools.test.ts',
    'code-agent/dev-web-hook.ts',
    'citations.ts',
  ]) {
    assert.equal(existsSync(resolve(CORE, rel)), false, `src/main/core/${rel} must be deleted`)
  }
  assert.equal(existsSync(resolve(CORE, '../../renderer/src/screens/DevWebPanel.tsx')), false, 'DevWebPanel.tsx must be deleted')
})

test('the offline retrieval modules survived the purge', () => {
  for (const rel of ['pack-delta.ts', 'verify-answer.ts']) {
    assert.equal(existsSync(resolve(CORE, rel)), true, `src/main/core/${rel} must hold the relocated offline logic`)
  }
})

test('no web-search channel remains in the IPC contract', () => {
  for (const dead of ['webCacheStatus', 'webCacheClear', 'devWebRun']) {
    assert.equal(dead in IPC, false, `IPC.${dead} must be removed (search was deleted, not disabled)`)
  }
  const keys = Object.keys(IPC)
  assert.equal(keys.some((k) => /web/i.test(k)), false, `no web channels may remain, found: ${keys.filter((k) => /web/i.test(k)).join(', ')}`)
})

test('the main service no longer imports the search pipeline', () => {
  const src = readFileSync(resolve(CORE, 'app-services.ts'), 'utf8')
  for (const dead of ['./search/', 'gatherOnline', 'web-cache.js', 'web-client.js', 'dev-web', 'web-decision', 'allowWeb']) {
    assert.equal(src.includes(dead), false, `app-services.ts must not reference ${dead}`)
  }
})

test('the pack selftest no longer boots a search proxy', () => {
  const src = readFileSync(resolve(CORE, 'pack-selftest.ts'), 'utf8')
  for (const dead of ['SEARXNG', 'FETCH_ALLOW_HOSTS', 'webSearchAllowed', './search/']) {
    assert.equal(src.includes(dead), false, `pack-selftest.ts must not reference ${dead}`)
  }
})

test('the chat router has no web branch left', () => {
  const src = readFileSync(resolve(CORE, 'chat-route.ts'), 'utf8')
  for (const dead of ['webChip', 'withWebBanner', 'wantsFreshInfo', 'OFFLINE_WEB_NOTE', 'WEB_FAIL_NOTE', "'web'"]) {
    assert.equal(src.includes(dead), false, `chat-route.ts must not reference ${dead}`)
  }
})

test('the renderer and the storage report have no web left', () => {
  const files = [
    '../../renderer/src/App.tsx',
    '../../renderer/src/env.d.ts',
    '../../renderer/src/screens/ChatScreen.tsx',
    '../../renderer/src/screens/SettingsScreen.tsx',
    '../../shared/ipc-contract.ts',
    './live/storage.ts',
  ]
  for (const rel of files) {
    const path = resolve(CORE, rel)
    assert.equal(existsSync(path), true, `${rel} must still exist for this check`)
    const src = readFileSync(path, 'utf8')
    for (const dead of ["'web'", 'webSearch', 'savedWeb', 'webCache', 'devWeb', 'myRegion', 'DevWebPanel', 'quoteChip']) {
      assert.equal(src.includes(dead), false, `${rel} must not reference ${dead}`)
    }
  }
  assert.equal(existsSync(resolve(CORE, '../../shared/quote.ts')), false, 'shared/quote.ts scraped quote pages and must be deleted')
})

test('the eval bank no longer scores web domains', () => {
  for (const rel of ['step11-questions.ts', 'step11-cases.ts', 'step11-suite.ts']) {
    const path = resolve(CORE, rel)
    if (!existsSync(path)) continue
    const src = readFileSync(path, 'utf8')
    for (const dead of ['./search/finance', './web-decision', 'decideWeb', 'wantsFresh', "'fresh'"]) {
      assert.equal(src.includes(dead), false, `${rel} must not reference ${dead}`)
    }
  }
})

test('docs/STEP-11.md counts match the question bank that ships', () => {
  const doc = readFileSync(resolve(CORE, '../../../../../docs/STEP-11.md'), 'utf8')
  const tally = new Map<string, number>()
  for (const question of evalQuestions()) tally.set(question.domain, (tally.get(question.domain) ?? 0) + 1)
  const total = [...tally.values()].reduce((sum, count) => sum + count, 0)
  const subset = selectModelEvalQuestions('subset').length
  const full = selectModelEvalQuestions('full').length
  assert.match(doc, new RegExp(`scores ${total} questions`), `docs/STEP-11.md must state the live total of ${total} questions`)
  assert.match(doc, new RegExp(`finance ${tally.get('finance')}`), `docs/STEP-11.md must state finance ${tally.get('finance')}`)
  assert.match(doc, new RegExp(`${subset}-question subset`), `docs/STEP-11.md must state the live ${subset}-question CI subset`)
  assert.match(doc, new RegExp(`${full}-question (run|model run)`), `docs/STEP-11.md must state the live ${full}-question full run`)
  for (const domain of ['coding', 'splitting', 'run-fix', 'screenshots', 'legal', 'everyday']) {
    // The prose writes run/fix, the code writes run-fix.
    const pattern = domain.replace('-', '[/-]')
    assert.match(doc, new RegExp(`${pattern} ${tally.get(domain)}`), `docs/STEP-11.md must state ${domain} ${tally.get(domain)}`)
  }
})

test('the finance maths that survived the purge never touches the network', () => {
  for (const rel of ['search/finance.ts', 'finance-maths.ts']) {
    const path = resolve(CORE, rel)
    if (!existsSync(path)) continue
    const src = readFileSync(path, 'utf8')
    for (const dead of ['politeFetch', './http', 'fetch(', 'jszip', './region']) {
      assert.equal(src.includes(dead), false, `${rel} must not reference ${dead}`)
    }
  }
})
