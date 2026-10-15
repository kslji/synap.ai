import React from 'react'
import type { AgentMeta } from '../../../packages/shared/src/agents'
import { Markdown } from '../../../packages/ui/src/markdown'
import type { AgentPost } from './agent-posts'

export function AgentBlog({ agent, posts }: { agent: AgentMeta; posts: AgentPost[] }) {
  return (
    <>
      <p className="pill">{agent.status === 'available' ? 'Available' : agent.status === 'beta' ? 'Beta' : 'Coming soon'}</p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight" data-agent-page={agent.id}>{agent.name}</h1>
      <p className="mt-3 text-lg text-[var(--muted)]">{agent.tagline}</p>
      <p className="mt-4 text-[15px] leading-relaxed text-[var(--muted)]">{agent.description}</p>
      {agent.notes && <p className="mt-3 text-sm text-[var(--muted)]">{agent.notes}</p>}
      <section className="mt-10" data-agent-blog={agent.id}>
        <h2 className="text-2xl font-semibold tracking-tight">Articles</h2>
        {posts.length === 0 && <p className="mt-3 text-sm text-[var(--muted)]">No articles yet.</p>}
        <ul className="mt-4 flex flex-col gap-3">
          {posts.map((post) => (
            <li key={post.slug}>
              <a className="card block px-5 py-4 no-underline" href={`/agents/${agent.id}/${post.slug}`} data-agent-post={post.slug}>
                <div className="text-lg font-semibold text-[var(--ink)]">{post.title}</div>
                {post.date && <div className="mt-1 text-xs text-[var(--muted)]">{post.date}</div>}
                {post.description && <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{post.description}</p>}
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

export function ArticleBody({ agent, post }: { agent: AgentMeta; post: AgentPost }) {
  return (
    <>
      <p className="text-sm">
        <a href={`/agents/${agent.id}`}>{agent.name}</a>
      </p>
      <article className="mt-4 text-[15px] leading-relaxed" data-article={post.slug} data-article-agent={agent.id}>
        <Markdown source={post.markdown} />
      </article>
    </>
  )
}
