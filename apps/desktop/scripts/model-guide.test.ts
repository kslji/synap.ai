import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown, markdownHrefs, sourceUrls } from '../../../packages/ui/src/markdown.tsx'

const root = new URL('../../..', import.meta.url).pathname
const article = readFileSync(join(root, 'agents/code/blog/qwen35-vs-gemma4.md'), 'utf8')

test('the offline model guide matches the Code picker and keeps source links', () => {
  assert.match(article, /Switch agent/)
  assert.match(article, /Chat model/)
  assert.match(article, /Which model should I pick\?/)
  assert.match(article, /Settings/)
  assert.match(article, /Code model/)
  assert.match(article, /Switch to smaller model/)
  assert.doesNotMatch(article, /Open the \*\*model picker\*\*/)
  assert.doesNotMatch(article, /until you delete them/)
  const hrefs = new Set(markdownHrefs(article))
  for (const url of new Set(sourceUrls(article))) assert.ok(hrefs.has(url), url)
  const html = renderToStaticMarkup(createElement(Markdown, { source: article }))
  assert.match(html, /data-markdown="yes"/)
  assert.match(html, /Chat model/)
  for (const url of new Set(sourceUrls(article))) assert.ok(html.includes(`href="${url}"`), url)
  const guide = readFileSync(join(root, 'apps/desktop/src/renderer/src/screens/ModelGuide.tsx'), 'utf8')
  assert.match(guide, /Which model should I pick\?/)
  assert.match(guide, /agents\/code\/blog\/qwen35-vs-gemma4\.md\?raw/)
  const chat = readFileSync(join(root, 'apps/desktop/src/renderer/src/screens/ChatScreen.tsx'), 'utf8')
  assert.match(chat, /modelGuide && <ModelGuideButton \/>/)
  const models = readFileSync(join(root, 'apps/desktop/src/renderer/src/screens/ModelsScreen.tsx'), 'utf8')
  assert.match(models, /heading === 'Code' && \(/)
  assert.match(models, /<ModelGuideButton \/>/)
})
