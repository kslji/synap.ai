import { agents } from '../../../packages/shared/src/agent-catalog'
import { AgentPage, ArticlePage, MissingPage } from './agent-page'
import { agentPosts } from './agent-blog'
import { findPost, postsFor } from './agent-posts'
import { Landing } from './landing'
import { BuyPage, ContributePage, PrivacyPage, SecurityPage, TermsPage } from './pages'

export function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  if (path === '/privacy') return <PrivacyPage />
  if (path === '/security') return <SecurityPage />
  if (path === '/contribute') return <ContributePage />
  if (path === '/terms') return <TermsPage />
  if (path === '/buy') return <BuyPage />
  const agentPath = /^\/agents\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(path)
  if (agentPath) {
    const agent = agents.find((item) => item.id === agentPath[1])
    if (!agent) return <MissingPage />
    const slug = agentPath[2]
    if (!slug) return <AgentPage agent={agent} posts={postsFor(agent.id, agentPosts)} />
    const post = findPost(agent.id, slug, agentPosts)
    if (!post) return <MissingPage />
    return <ArticlePage agent={agent} post={post} />
  }
  return <Landing />
}
