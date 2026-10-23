import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { MARKDOWN_RULE, chatSystemPrompt } from '@surf/agent-core'
import {
  NOTES_LIMIT,
  NOTIFY_LIMIT,
  PREVIEW_LIMIT,
  SIDEBAR_PREVIEW_LIMIT,
  SIDEBAR_TITLE_LIMIT,
  SPEAK_LIMIT,
  TITLE_LIMIT,
  balanceMarkdown,
  clipWords,
  closeAtBoundary,
  finishReply,
  joinTokenPieces,
  joinUtf8Chunks,
  markdownBalanced,
  replyShapeOk,
  streamingMarkdown,
} from './reply-text.js'

const LONG = 'How do you keep a very long chat title from ending in the middle of a word today please'

function clippedAtWord(source: string, max: number): string {
  const clipped = clipWords(source, max)
  assert.ok(clipped.endsWith('…'), clipped)
  const body = clipped.slice(0, -1)
  assert.ok(source.startsWith(body), `${JSON.stringify(body)} is not a prefix of the source`)
  assert.equal(source[body.length], ' ')
  assert.equal(clipped.includes('\uFFFD'), false)
  return clipped
}

test('token pieces join into whole words', () => {
  assert.equal(joinTokenPieces(['hel', 'lo ', 'wor', 'ld']), 'hello world')
  assert.equal(joinTokenPieces(['\uD83D', '\uDE00']).includes('\uFFFD'), false)
  assert.equal(joinTokenPieces(['\uD83D', '\uDE00']), '😀')
  assert.equal(replyShapeOk(joinTokenPieces(['hel', 'lo'])), true)
})

test('UTF-8 chunks join when a character is split across reads', () => {
  const cafe = new TextEncoder().encode('café')
  const split = joinUtf8Chunks([cafe.slice(0, 3), cafe.slice(3)])
  assert.equal(split, 'café')
  assert.equal(split.includes('\uFFFD'), false)
  const emoji = new TextEncoder().encode('Hi 😀')
  assert.equal(joinUtf8Chunks([emoji.slice(0, 4), emoji.slice(4, 5), emoji.slice(5)]), 'Hi 😀')
  assert.equal(joinUtf8Chunks([emoji.slice(0, 1), emoji.slice(1)]), 'Hi 😀')
})

test('a length stop drops the partial last word and can continue', () => {
  const cut = closeAtBoundary('Hello world comput')
  assert.equal(cut.text, 'Hello world')
  assert.equal(cut.clipped, true)
  const finished = finishReply('Sorting keeps the original list and returns a new one comput', true)
  assert.equal(finished.canContinue, true)
  assert.equal(finished.text, 'Sorting keeps the original list and returns a new one')
  assert.doesNotMatch(finished.text, /comput/)
  assert.equal(replyShapeOk(finished.text), true)
  const sentence = finishReply('First sentence. Then a cut wo', true)
  assert.equal(sentence.text, 'First sentence.')
  assert.equal(sentence.canContinue, true)
  assert.equal(finishReply('Hello world.', true).text, 'Hello world.')
  assert.deepEqual(finishReply('allow', false), { text: 'allow', canContinue: false })
  assert.equal(closeAtBoundary('comput').text, '')
})

test('titles and previews truncate on a word with an ellipsis', () => {
  assert.equal(clipWords('Hello', TITLE_LIMIT), 'Hello')
  assert.equal(clipWords('Hello', PREVIEW_LIMIT), 'Hello')
  const title = clippedAtWord(LONG, TITLE_LIMIT)
  const preview = clippedAtWord(`${LONG} and then a little more detail for the row`, PREVIEW_LIMIT)
  const sideTitle = clippedAtWord(LONG, SIDEBAR_TITLE_LIMIT)
  const sidePreview = clippedAtWord(LONG, SIDEBAR_PREVIEW_LIMIT)
  assert.ok(title.length <= TITLE_LIMIT)
  assert.ok(preview.length <= PREVIEW_LIMIT)
  assert.ok(sideTitle.length <= SIDEBAR_TITLE_LIMIT)
  assert.ok(sidePreview.length <= SIDEBAR_PREVIEW_LIMIT)
  const spoken = clippedAtWord(`${LONG} `.repeat(80).trim(), SPEAK_LIMIT)
  const note = clippedAtWord(`${LONG} `.repeat(20).trim(), NOTES_LIMIT)
  const notify = clippedAtWord(`${LONG} `.repeat(8).trim(), NOTIFY_LIMIT)
  assert.ok(spoken.length <= SPEAK_LIMIT)
  assert.ok(note.length <= NOTES_LIMIT)
  assert.ok(notify.length <= NOTIFY_LIMIT)
  const emoji = clipWords('Hello 😀 world extra words', 12)
  assert.equal(emoji.includes('\uFFFD'), false)
  assert.equal(replyShapeOk(emoji.replace(/…$/, '')), true)
})

test('streaming hides an open fence and the final reply closes markup', () => {
  assert.equal(streamingMarkdown('Hello **wor'), 'Hello ')
  assert.equal(streamingMarkdown('See\n```js\nconst x'), 'See\n')
  assert.equal(streamingMarkdown('Hello 😀'.slice(0, 'Hello 😀'.length - 1)), 'Hello ')
  const closed = balanceMarkdown('```js\nconst n = 1')
  assert.equal(markdownBalanced(closed), true)
  assert.equal(markdownBalanced('**bold'), false)
  assert.equal(replyShapeOk('pre-'), false)
  assert.equal(replyShapeOk('ok\uFFFD'), false)
  assert.equal(replyShapeOk(''), true)
  // Item 13: the words the model is told live in @surf/agent-core, not here.
  assert.match(MARKDOWN_RULE, /Markdown/)
  assert.match(MARKDOWN_RULE, /do not stop in the middle of a word/)
  assert.match(MARKDOWN_RULE, /\[S1\]/)
  assert.match(MARKDOWN_RULE, /Source heading/)
})

test('the chat system prompt asks for closed markdown', () => {
  const source = readFileSync(new URL('../main/core/app-services.ts', import.meta.url), 'utf8')
  assert.match(source, /const SYSTEM = chatSystemPrompt\('offline'\)/)
  assert.equal(chatSystemPrompt('offline').includes(MARKDOWN_RULE), true)
})
