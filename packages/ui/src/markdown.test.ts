import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from './markdown.tsx'

const SOURCE = [
  '## Sorting a list',
  '',
  'Use **stable** sort when the original order matters. Call `items.slice()` before you sort.',
  '',
  '- Keep the original list',
  '- Return a new one',
  '- Check the length first',
  '',
  '1. Copy the items',
  '2. Sort the copy',
  '3. Return it',
  '',
  '```js',
  'function sorted(items) {',
  '  const copy = items.slice()',
  '  return copy.sort()',
  '}',
  '```',
  '',
  '| Step | What it does |',
  '| --- | --- |',
  '| Copy | Leaves the input alone |',
  '| Sort | Orders the copy |',
  '',
  '$$E = mc^2$$',
  '',
  'Read the [notes](https://example.com/sort).',
].join('\n')

function htmlOf(source: string): string {
  return renderToStaticMarkup(createElement(Markdown, { source, compact: true }))
}

test('each reply element renders and raw markdown stays out of the bubble', () => {
  const html = htmlOf(SOURCE)
  assert.match(html, /<h2[^>]*>/)
  assert.match(html, /Sorting a list/)
  assert.match(html, /<ul/)
  assert.match(html, /<ol/)
  assert.match(html, /<strong>/)
  assert.match(html, />stable</)
  assert.match(html, /<code>items\.slice\(\)<\/code>/)
  assert.match(html, /data-code-block="yes"/)
  assert.match(html, /data-copy-code="yes"/)
  assert.match(html, />Copy</)
  assert.match(html, /data-token="keyword">const</)
  assert.match(html, /data-token="keyword">return</)
  assert.match(html, /<table/)
  assert.match(html, /Leaves the input alone/)
  assert.match(html, /href="https:\/\/example\.com\/sort"/)
  assert.match(html, /data-latex="yes"/)
  assert.match(html, /mc²/)
  assert.doesNotMatch(html, /\*\*/)
  assert.doesNotMatch(html, /```/)
  assert.doesNotMatch(html, /###/)
  assert.doesNotMatch(html, /\$\$/)
  assert.doesNotMatch(html, /^- Keep/m)
  assert.equal(html.includes('\uFFFD'), false)
})

test('an open fence becomes a code block instead of a raw fence', () => {
  const html = htmlOf('```js\nconst n = 1\n```')
  assert.match(html, /data-code-block="yes"/)
  assert.match(html, /data-copy-code="yes"/)
  assert.doesNotMatch(html, /```/)
})
