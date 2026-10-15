import { splitFrontmatter } from '../../../packages/ui/src/markdown'

export interface AgentPost {
  agentId: string
  slug: string
  title: string
  description: string
  date: string
  markdown: string
}

export function loadAgentPosts(modules: Record<string, string>): AgentPost[] {
  return Object.entries(modules).flatMap(([path, markdown]) => {
    const match = /agents\/([^/]+)\/blog\/([^/]+)\.md$/.exec(path)
    if (!match) return []
    const meta = splitFrontmatter(markdown)
    return [{
      agentId: match[1],
      slug: match[2],
      title: meta.title || match[2],
      description: meta.description,
      date: meta.date,
      markdown,
    }]
  }).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))
}

export function postsFor(agentId: string, posts: AgentPost[]): AgentPost[] {
  return posts.filter((post) => post.agentId === agentId)
}

export function findPost(agentId: string, slug: string, posts: AgentPost[]): AgentPost | undefined {
  return posts.find((post) => post.agentId === agentId && post.slug === slug)
}
