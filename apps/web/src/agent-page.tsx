import type { ReactNode } from 'react'
import type { AgentMeta } from '../../../packages/shared/src/agents'
import { AgentBlog, ArticleBody } from './agent-blog-view'
import type { AgentPost } from './agent-posts'
import { SiteFooter, SiteHeader, useTheme } from './pages'

function Frame({ children }: { children: ReactNode }) {
  const [theme, onTheme] = useTheme()
  return (
    <div>
      <SiteHeader theme={theme} onTheme={onTheme} />
      <main className="mx-auto max-w-3xl px-6 pb-16">{children}</main>
      <SiteFooter />
    </div>
  )
}

export function AgentPage({ agent, posts }: { agent: AgentMeta; posts: AgentPost[] }) {
  return (
    <Frame>
      <AgentBlog agent={agent} posts={posts} />
    </Frame>
  )
}

export function ArticlePage({ agent, post }: { agent: AgentMeta; post: AgentPost }) {
  return (
    <Frame>
      <ArticleBody agent={agent} post={post} />
    </Frame>
  )
}

export function MissingPage() {
  return (
    <Frame>
      <h1 className="text-4xl font-semibold tracking-tight">That page is not here</h1>
      <p className="mt-4 text-[var(--muted)]"><a href="/">Back to the start</a></p>
    </Frame>
  )
}
