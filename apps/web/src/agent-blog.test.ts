import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseAgentFile } from '../../../packages/shared/src/agents.ts'
import { Markdown, markdownHrefs, sourceUrls } from '../../../packages/ui/src/markdown.tsx'
import { AgentCards } from './AgentCards.tsx'
import { AgentBlog, ArticleBody } from './agent-blog-view.tsx'
import { loadAgentPosts } from './agent-posts.ts'

const root = new URL('../../..', import.meta.url).pathname
const article = `---
title: "Getting started with Code"
description: "A short guide."
date: 2026-10-20
---

# Getting started with Code

Code runs on your laptop with [llama.cpp](https://github.com/ggml-org/llama.cpp).
`

test('an agent page lists its articles and keeps every source link', () => {
  const posts = loadAgentPosts({ 'agents/code/blog/getting-started.md': article })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].slug, 'getting-started')
  assert.match(posts[0].title, /Getting started with Code/)
  const agent = parseAgentFile('code', JSON.parse(readFileSync(join(root, 'agents/code/agent.json'), 'utf8')))
  const page = renderToStaticMarkup(createElement(AgentBlog, { agent, posts }))
  assert.match(page, /data-agent-page="code"/)
  assert.match(page, /data-agent-blog="code"/)
  assert.match(page, /data-agent-post="getting-started"/)
  assert.match(page, /href="\/agents\/code\/getting-started"/)
  const articleHtml = renderToStaticMarkup(createElement(ArticleBody, { agent, post: posts[0] }))
  assert.match(articleHtml, /data-article="getting-started"/)
  const hrefs = new Set(markdownHrefs(article))
  for (const url of sourceUrls(article)) assert.ok(hrefs.has(url), url)
  const rendered = renderToStaticMarkup(createElement(Markdown, { source: article }))
  for (const url of sourceUrls(article)) assert.ok(rendered.includes(`href="${url}"`), url)
  const empty = renderToStaticMarkup(createElement(AgentBlog, { agent, posts: [] }))
  assert.match(empty, /No articles yet/)
  const cards = renderToStaticMarkup(createElement(AgentCards, { agents: [agent], guides: { code: '/agents/code' } }))
  assert.match(cards, /data-agent-guide="code"/)
  assert.match(cards, /href="\/agents\/code"/)
})
