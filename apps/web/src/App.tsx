import { Landing } from './landing'
import { ContributePage, PrivacyPage, SecurityPage, TermsPage } from './pages'

export function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  if (path === '/privacy') return <PrivacyPage />
  if (path === '/security') return <SecurityPage />
  if (path === '/contribute') return <ContributePage />
  if (path === '/terms') return <TermsPage />
  return <Landing />
}
