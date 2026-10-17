/** Website copy only. The app catalog still lists General as available and Code and Assistant as beta. */
export type WebsiteAgentState = 'ready' | 'coming soon'

export function websiteAgentState(id: string): WebsiteAgentState {
  return id === 'code' ? 'ready' : 'coming soon'
}

export function leadWithCode<T extends { id: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => Number(b.id === 'code') - Number(a.id === 'code'))
}
