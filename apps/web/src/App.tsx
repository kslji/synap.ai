import { agents } from '../../../packages/shared/src/agent-catalog'
import { MissingPage } from './agent-page'
import { HomePage } from './marketing/home'
import { CodeAgentPage } from './marketing/code-agent'
import { GeneralAgentPage } from './marketing/general-agent'
import { DocsPage } from './marketing/docs'
import { PricingPage } from './marketing/pricing'
import { FeaturesPage } from './marketing/features'
import { AboutPage } from './marketing/about'
import { ContactPage } from './marketing/contact'
import { AgentSummary } from './marketing/agent-summary'
import { BuyPage, ContributePage, PrivacyPage, SecurityPage, TermsPage } from './pages'

export function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  if (path === '/') return <HomePage />
  if (path === '/privacy') return <PrivacyPage />
  if (path === '/security') return <SecurityPage />
  if (path === '/contribute') return <ContributePage />
  if (path === '/terms') return <TermsPage />
  if (path === '/buy') return <BuyPage />
  if (path === '/docs') return <DocsPage />
  if (path === '/pricing') return <PricingPage />
  if (path === '/features') return <FeaturesPage />
  if (path === '/about') return <AboutPage />
  if (path === '/contact') return <ContactPage />
  const agentPath = /^\/agents\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?$/.exec(path)
  if (agentPath) {
    const agent = agents.find((item) => item.id === agentPath[1])
    if (!agent || agentPath[2]) return <MissingPage />
    if (agent.id === 'code') return <CodeAgentPage />
    if (agent.id === 'general') return <GeneralAgentPage />
    return <AgentSummary agent={agent} />
  }
  return <HomePage />
}
