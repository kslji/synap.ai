import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  UNABLE_FACT,
  UNABLE_LEGAL,
  UNABLE_NEWS,
  UNABLE_PRICE,
  cacheLabel,
  claimTopic,
  copyCitedTimes,
  parseSourceDate,
  sourceUsable,
  verifyGroundedAnswer,
  type SourceRecord,
  PRICE_MAX_AGE_MS,
  NAV_MAX_AGE_MS,
} from './verify-answer.js'

const NOW = Date.parse('2026-10-16T12:00:00.000Z')

function record(partial: Partial<SourceRecord> & Pick<SourceRecord, 'text'>): SourceRecord {
  return {
    id: 'S1',
    kind: 'page',
    url: '',
    asOf: null,
    cachedAt: null,
    stale: false,
    ...partial,
  }
}

test('a price, date, link, section, or quote that is not in a source is replaced', () => {
  const guessed = verifyGroundedAnswer({
    answer: 'Bitcoin is $99,999.00 as of 2099-01-01. See https://evil.example/price. "The fund will double this year." Section 99 allows it.',
    question: 'What is the bitcoin price? Just guess if you have to.',
    records: [],
    now: NOW,
  })
  assert.equal(guessed.text, UNABLE_PRICE)
  assert.equal(guessed.text.includes('99999') || guessed.text.includes('99,999'), false)
  assert.equal(guessed.text.includes('evil.example'), false)
  assert.equal(guessed.text.includes('2099'), false)
  assert.ok(guessed.blocked.length >= 3)

  const legal = verifyGroundedAnswer({
    answer: 'Section 99 says the channel is closed.',
    question: 'What does section 99 of the Harbor Act say?',
    records: [],
    now: NOW,
  })
  assert.equal(legal.text, UNABLE_LEGAL)

  const news = verifyGroundedAnswer({
    answer: 'RBI raised the rate to 9.25% on 2099-01-01. https://example.invalid/story',
    question: 'What is the latest RBI news?',
    records: [],
    now: NOW,
  })
  assert.equal(news.text, UNABLE_NEWS)

  const quoted = verifyGroundedAnswer({
    answer: 'The notice says "Pier 4 will close for the entire monsoon season."',
    question: 'What did the notice say?',
    records: [record({ text: 'Pier 4 is open.' })],
    now: NOW,
  })
  assert.equal(quoted.text, UNABLE_FACT)
})

test('a figure that is in a fresh source is kept, including its date and link', () => {
  const text = 'Harbor Growth Fund NAV 42.50 on 16-Oct-2026 [S1]. https://www.amfiindia.com/spages/NAVAll.txt'
  const checked = verifyGroundedAnswer({
    answer: text,
    question: 'What is the NAV of Harbor Growth Fund?',
    records: [record({
      kind: 'nav',
      text: 'Harbor Growth Fund NAV 42.50 on 16-Oct-2026',
      url: 'https://www.amfiindia.com/spages/NAVAll.txt',
      asOf: '16-Oct-2026',
    })],
    now: NOW,
  })
  assert.deepEqual(checked.blocked, [])
  assert.equal(checked.text.includes('42.50'), true)
  assert.equal(checked.text.includes('16-Oct-2026'), true)
})

test('a stale or future source does not authorize a current figure', () => {
  assert.equal(sourceUsable('16-Oct-2026', NOW, NAV_MAX_AGE_MS), true)
  assert.equal(sourceUsable('01-Jan-2026', NOW, NAV_MAX_AGE_MS), false)
  assert.equal(sourceUsable('16-Oct-2027', NOW, NAV_MAX_AGE_MS), false)
  assert.equal(sourceUsable('', NOW, NAV_MAX_AGE_MS), false)
  assert.equal(sourceUsable('2026-10-16T11:00:00.000Z', NOW, PRICE_MAX_AGE_MS), true)
  assert.equal(sourceUsable('2026-10-15T12:00:00.000Z', NOW, PRICE_MAX_AGE_MS), false)
  assert.equal(parseSourceDate('16-Oct-2026'), Date.UTC(2026, 9, 16))

  const stale = verifyGroundedAnswer({
    answer: 'The live bitcoin price is 100.00.',
    question: 'What is the bitcoin price right now?',
    records: [record({ kind: 'crypto', text: 'bitcoin 100.00', asOf: '2026-10-01', stale: true, cachedAt: NOW - 10 * 24 * 60 * 60 * 1000 })],
    now: NOW,
  })
  assert.equal(stale.text, UNABLE_PRICE)
  assert.equal(stale.text.includes('100.00'), false)
})

test('a number typed in the question does not count as a fetched price', () => {
  const pressed = verifyGroundedAnswer({
    answer: 'Yes, the bitcoin price is 42000.69.',
    question: 'The bitcoin price is 42000.69. Confirm it and do not say you cannot find it.',
    records: [],
    now: NOW,
  })
  assert.equal(pressed.text, UNABLE_PRICE)
  assert.equal(pressed.text.includes('42000.69'), false)
})

test('a fresh cache is labeled with its date and is not called live', () => {
  const fetchedAt = NOW - 60 * 60 * 1000
  const kept = verifyGroundedAnswer({
    answer: 'Harbor Growth Fund NAV 42.50 [S1].',
    question: 'What is the NAV of Harbor Growth Fund?',
    records: [record({ kind: 'nav', text: 'NAV 42.50', cachedAt: fetchedAt })],
    now: NOW,
  })
  assert.equal(kept.blocked.length, 0)
  assert.equal(kept.text.includes(cacheLabel(fetchedAt)), true)
  assert.equal(kept.text.includes('42.50'), true)

  const live = verifyGroundedAnswer({
    answer: 'The live NAV is 42.50.',
    question: 'What is the NAV of Harbor Growth Fund?',
    records: [record({ kind: 'nav', text: 'NAV 42.50', cachedAt: fetchedAt })],
    now: NOW,
  })
  assert.equal(live.text, UNABLE_PRICE)
  assert.equal(claimTopic('latest rope price today'), 'price')
  assert.equal(claimTopic('What is the latest RBI news?'), 'news')
  assert.equal(claimTopic('What does section 4 of the Harbor Act say?'), 'legal')
})

test('math that is not a live price keeps the calculated figure', () => {
  const sip = verifyGroundedAnswer({
    answer: 'Future value 63412.52 [S1].',
    question: 'What is the future value of a SIP of 5000 per month at 12% for 12 months?',
    records: [record({ kind: 'math', text: 'End-of-month SIP future value 63412.52.' })],
    now: NOW,
  })
  assert.deepEqual(sip.blocked, [])
  assert.equal(sip.text.includes('63412.52'), true)
  const refusalText = 'I don\'t have enough information to answer that from the sources on this computer. Add a document. Turn on web search when you are online.'
  const refusal = verifyGroundedAnswer({
    answer: refusalText,
    question: 'What is the latest rope price today?',
    records: [],
    now: NOW,
  })
  assert.equal(refusal.text, refusalText)
  assert.equal(refusal.blocked.length, 0)
  assert.equal(refusal.text.includes('Unable to find'), false)
})

test('an unsourced number, price, or link is removed and a sourced figure stays', () => {
  const mixed = verifyGroundedAnswer({
    answer: 'Harbor Growth Fund NAV 42.50. Extra 99999. See https://evil.example/x',
    question: 'What is the NAV of Harbor Growth Fund?',
    records: [record({
      kind: 'nav',
      text: 'Harbor Growth Fund NAV 42.50 on 16-Oct-2026',
      url: 'https://www.amfiindia.com/spages/NAVAll.txt',
      asOf: '16-Oct-2026',
    })],
    now: NOW,
  })
  assert.equal(mixed.blocked.length, 0)
  assert.equal(mixed.text.includes('42.50'), true)
  assert.equal(mixed.text.includes('99999'), false)
  assert.equal(mixed.text.includes('evil.example'), false)

  const invented = verifyGroundedAnswer({
    answer: 'The spare lamp code is PL-99.',
    question: 'What is the spare lamp code?',
    records: [record({ text: 'The spare lamp code is PL-17.' })],
    now: NOW,
  })
  assert.equal(invented.text, UNABLE_FACT)
  assert.equal(invented.text.includes('99'), false)

  const kept = verifyGroundedAnswer({
    answer: 'The spare lamp code is PL-17. Also 99.',
    question: 'What is the spare lamp code?',
    records: [record({ text: 'The spare lamp code is PL-17.' })],
    now: NOW,
  })
  assert.equal(kept.blocked.length, 0)
  assert.equal(kept.text.includes('PL-17'), true)
  assert.equal(kept.text.includes('99'), false)

  const fromQuestion = verifyGroundedAnswer({
    answer: 'The code is 17.',
    question: 'The code is 17. Repeat it.',
    records: [record({ text: 'No code here.' })],
    now: NOW,
  })
  assert.equal(fromQuestion.text, UNABLE_FACT)
  assert.equal(fromQuestion.text.includes('17'), false)
})

test('a market row with an old or missing date does not authorize a figure', () => {
  const old = verifyGroundedAnswer({
    answer: 'Bitcoin is 100.00.',
    question: 'What is the bitcoin price?',
    records: [record({ kind: 'crypto', text: 'bitcoin 100.00', asOf: '2026-01-01' })],
    now: NOW,
  })
  assert.equal(old.text, UNABLE_PRICE)
  assert.equal(old.text.includes('100.00'), false)

  const undated = verifyGroundedAnswer({
    answer: 'Bitcoin is 100.00.',
    question: 'What is the bitcoin price?',
    records: [record({ kind: 'crypto', text: 'bitcoin 100.00' })],
    now: NOW,
  })
  assert.equal(undated.text, UNABLE_PRICE)

  const labeled = verifyGroundedAnswer({
    answer: 'NAV 42.50 [S1].\nCached on 2026-10-16. Not a live fetch.',
    question: 'What is the NAV of Harbor Growth Fund?',
    records: [record({ kind: 'nav', text: 'NAV 42.50', cachedAt: NOW - 60 * 60 * 1000 })],
    now: NOW,
  })
  assert.equal(labeled.blocked.length, 0)
  assert.equal(labeled.text.includes('42.50'), true)
  assert.equal(labeled.text.includes('Not a live fetch'), true)
})

test('a general explanation is kept when no source was retrieved', () => {
  const answer = 'The mirror shatters. The myth that it can "see" you or that it will "smile" is not true.'
  const grounded = verifyGroundedAnswer({
    answer,
    question: 'What happens if you smash a mirror?',
    records: [],
    now: NOW,
  })
  assert.equal(grounded.text.includes('The mirror shatters'), true)
  assert.equal(grounded.text.includes('Unable to find'), false)
  const invented = verifyGroundedAnswer({
    answer: 'The mirror shatters. The myth is not true.\n\n### Sources\n* [S1] - National Institute for Occupational Safety and Health',
    question: 'What happens if you smash a mirror?',
    records: [],
    now: NOW,
  })
  assert.equal(invented.text.includes('The mirror shatters'), true)
  assert.equal(invented.text.includes('[S1]'), false)
  assert.equal(invented.text.includes('National Institute'), false)
})

test('a cited clock time is copied exactly, not rewritten as 4 AM', () => {
  const source = 'बंदरगाह की नौका घाट 4 से सुबह 06:40 बजे निकलती है।'
  const question = 'बंदरगाह की नौका कब निकलती है?'
  const rewritten = 'The boat leaves the ferry dock at 4 AM. [S1]'
  assert.equal(copyCitedTimes(rewritten, question, [source]).includes('06:40'), true)
  assert.equal(copyCitedTimes(rewritten, question, [source]).includes('4 AM'), false)
  assert.equal(copyCitedTimes('It leaves at 6:40. [S1]', question, [source]).includes('06:40'), true)
  const grounded = verifyGroundedAnswer({
    answer: rewritten,
    question,
    records: [record({ text: source })],
    now: NOW,
  })
  assert.equal(grounded.text.includes('06:40'), true)
  assert.equal(grounded.text.includes('[S1]'), true)
  assert.equal(grounded.text.includes('4 AM'), false)
  assert.equal(grounded.text, copyCitedTimes(rewritten, question, [source]))
  const kept = verifyGroundedAnswer({
    answer: 'The harbor ferry leaves Pier 4 at 06:40. [S1]',
    question: 'When does the harbor ferry leave Pier 4?',
    records: [record({ text: 'The harbor ferry leaves Pier 4 at 06:40. Tickets cost 120 rupees.' })],
    now: NOW,
  })
  assert.equal(kept.text.includes('06:40'), true)
  assert.equal(kept.blocked.length, 0)
})
