import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseAgentFile } from '../../../packages/shared/src/agents.ts'
import { markdownHrefs, sourceUrls } from '../../../packages/ui/src/markdown.ts'
import { Markdown } from '../../../packages/ui/src/Markdown.tsx'
import { AgentCards } from './AgentCards.tsx'
import { AgentBlog, ArticleBody } from './agent-blog-view.tsx'
import { loadAgentPosts } from './agent-posts.ts'

const root = new URL('../../..', import.meta.url).pathname
const articlePath = join(root, 'agents/code/blog/qwen35-vs-gemma4.md')
const article = readFileSync(articlePath, 'utf8')

test('the Code agent page lists the model guide and keeps every source link', () => {
  const posts = loadAgentPosts({ 'agents/code/blog/qwen35-vs-gemma4.md': article })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].slug, 'qwen35-vs-gemma4')
  assert.match(posts[0].title, /Qwen3\.5 vs Gemma 4/)
  const agent = parseAgentFile('code', JSON.parse(readFileSync(join(root, 'agents/code/agent.json'), 'utf8')))
  const page = renderToStaticMarkup(createElement(AgentBlog, { agent, posts }))
  assert.match(page, /data-agent-page="code"/)
  assert.match(page, /data-agent-blog="code"/)
  assert.match(page, /data-agent-post="qwen35-vs-gemma4"/)
  assert.match(page, /href="\/agents\/code\/qwen35-vs-gemma4"/)
  const articleHtml = renderToStaticMarkup(createElement(ArticleBody, { agent, post: posts[0] }))
  assert.match(articleHtml, /data-article="qwen35-vs-gemma4"/)
  assert.match(articleHtml, /Switch agent/)
  assert.match(articleHtml, /Chat model/)
  assert.match(articleHtml, /Which model should I pick\?/)
  assert.match(articleHtml, /Code model/)
  assert.match(articleHtml, /Switch to smaller model/)
  assert.doesNotMatch(articleHtml, /Open the model picker/)
  const hrefs = new Set(markdownHrefs(article))
  for (const url of sourceUrls(article)) assert.ok(hrefs.has(url), url)
  const rendered = renderToStaticMarkup(createElement(Markdown, { source: article }))
  for (const url of sourceUrls(article)) assert.ok(rendered.includes(`href="${url}"`), url)
  const cards = renderToStaticMarkup(createElement(AgentCards, { agents: [agent], guides: { code: '/agents/code' } }))
  assert.match(cards, /data-agent-guide="code"/)
  assert.match(cards, /href="\/agents\/code"/)
})
