import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OfflineOnlyError } from './offline-guard.js'
import { describeReach } from './reach.js'
import { fetchPages, searchWeb } from './web-client.js'
import {
  HINT_FAILED,
  HINT_OFFLINE,
  HINT_WEB_OFF,
  SOURCE_REFUSAL,
  decideWeb,
  formatWebCitation,
  parseSearchQueries,
  rankPassages,
  refusalMessage,
  searchBody,
  wantsFresh,
} from './web-decision.js'

test('freshness words', () => {
  assert.equal(wantsFresh('What is the price today?'), true)
  assert.equal(wantsFresh('latest ferry notice for 2026'), true)
  assert.equal(wantsFresh('What time does the harbor ferry leave?'), false)
})

test('decision flow', () => {
  const base = { online: true, offlineOnly: false, webAllowed: true }
  assert.equal(decideWeb({ ...base, local: 'skip', fresh: false }).branch, 'local')
  assert.equal(decideWeb({ ...base, local: 'skip', fresh: true }).branch, 'web')
  assert.equal(decideWeb({ ...base, local: 'answer', fresh: false }).branch, 'local')
  assert.equal(decideWeb({ ...base, local: 'borderline', fresh: false }).branch, 'local')
  assert.equal(decideWeb({ ...base, local: 'answer', fresh: true }).branch, 'blend')
  assert.equal(decideWeb({ ...base, local: 'borderline', fresh: true }).branch, 'blend')
  assert.equal(decideWeb({ ...base, local: 'insufficient', fresh: false }).branch, 'web')
  assert.equal(decideWeb({ ...base, local: 'insufficient', fresh: true }).branch, 'web')
  assert.deepEqual(
    decideWeb({ local: 'insufficient', fresh: true, online: true, offlineOnly: true, webAllowed: true }),
    { branch: 'refuse', hint: HINT_OFFLINE },
  )
  assert.deepEqual(
    decideWeb({ local: 'skip', fresh: true, online: false, offlineOnly: false, webAllowed: true }),
    { branch: 'refuse', hint: HINT_OFFLINE },
  )
  assert.deepEqual(
    decideWeb({ local: 'insufficient', fresh: false, online: true, offlineOnly: false, webAllowed: false }),
    { branch: 'refuse', hint: HINT_WEB_OFF },
  )
  assert.equal(decideWeb({ local: 'answer', fresh: true, online: false, offlineOnly: false, webAllowed: true }).branch, 'local')
})

test('refusal is the agreed sentence plus a hint', () => {
  assert.equal(refusalMessage(HINT_OFFLINE), `${SOURCE_REFUSAL} ${HINT_OFFLINE}`)
  assert.equal(refusalMessage(HINT_FAILED), `${SOURCE_REFUSAL} ${HINT_FAILED}`)
  assert.match(refusalMessage(HINT_WEB_OFF), /Turn on web search/)
})

test('query rewrite parsing', () => {
  assert.deepEqual(parseSearchQueries('{"queries":["pier 9 beacon today","surf code"]}', 'fallback'), ['pier 9 beacon today', 'surf code'])
  assert.deepEqual(parseSearchQueries('```json\n{"queries":["one","two","three","four"]}\n```', 'fallback'), ['one', 'two', 'three'])
  assert.deepEqual(parseSearchQueries('1. pier beacon\n2. surf code today', 'fallback'), ['pier beacon', 'surf code today'])
  assert.deepEqual(parseSearchQueries('- alpha\n- beta', 'fallback'), ['alpha', 'beta'])
  assert.deepEqual(parseSearchQueries('not json at all, just a paragraph that is far too long to be a search query and should be dropped instead of being sent to the search service as written', 'What is the beacon today?'), ['What is the beacon today?'])
})

test('search body is only the query', () => {
  const body = searchBody('pier 9 today', 5)
  assert.deepEqual(Object.keys(body).sort(), ['k', 'query'])
  assert.equal(JSON.stringify(body).includes('document'), false)
})

test('web citation is title, domain, and date', () => {
  assert.equal(
    formatWebCitation({ title: 'Pier 9 beacon', url: 'https://www.example.com/beacon', published: '2026-10-09' }),
    'Pier 9 beacon · example.com · 9 Oct 2026',
  )
})

test('passages rank by cosine', () => {
  const ranked = rankPassages([1, 0], [
    { text: 'far', title: 'a', url: 'https://a.example', published: null, vec: [0, 1] },
    { text: 'near', title: 'b', url: 'https://b.example', published: null, vec: [1, 0] },
  ])
  assert.equal(ranked[0].text, 'near')
  assert.ok(ranked[0].cosine > ranked[1].cosine)
})

test('reach reasons', () => {
  assert.deepEqual(describeReach({ osOnline: true, apiReachable: true, offlineOnly: true, checking: false }), { online: false, reason: 'Offline only is on' })
  assert.equal(describeReach({ osOnline: false, apiReachable: true, offlineOnly: false, checking: false }).reason, 'No network')
  assert.equal(describeReach({ osOnline: true, apiReachable: false, offlineOnly: false, checking: true }).reason, 'Checking the connection')
  assert.equal(describeReach({ osOnline: true, apiReachable: false, offlineOnly: false, checking: false }).reason, 'Search service unreachable')
  assert.equal(describeReach({ osOnline: true, apiReachable: true, offlineOnly: false, checking: false }).online, true)
})

test('offline only blocks search and fetch before any request', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return new Response('no')
  }
  await assert.rejects(() => searchWeb({ base: 'http://127.0.0.1:9', token: 't', query: 'beacon', offlineOnly: true, fetchImpl }), OfflineOnlyError)
  await assert.rejects(() => fetchPages({ base: 'http://127.0.0.1:9', token: 't', urls: ['http://example.com'], offlineOnly: true, fetchImpl }), OfflineOnlyError)
  assert.equal(calls, 0)
})
