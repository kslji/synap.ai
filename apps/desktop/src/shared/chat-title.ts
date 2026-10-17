/** Titles and agent switches for a chat. A chat keeps the agent it was started with. */

const AGENT_NAME = /^[\p{L}\p{N}][\p{L}\p{N} '&+.-]{0,40}$/u

export function labelFromAgentId(agentId: string): string {
  const id = agentId.trim().toLowerCase()
  if (!id || id === 'general') return 'General'
  return id.split('-').filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

/** Shown until the first real message replaces it. Never a topic the person did not write. */
export function newChatTitle(agentName: string): string {
  const name = agentName.replace(/\s+/g, ' ').trim()
  if (!name || !AGENT_NAME.test(name)) return 'New chat'
  return `New ${name} chat`
}

export function isPlaceholderTitle(title: string): boolean {
  if (title === 'New chat') return true
  const match = /^New (.+) chat$/.exec(title)
  if (!match?.[1]) return false
  return newChatTitle(match[1]) === title
}

export function messagePlaceholder(agentName: string): string {
  const name = agentName.replace(/\s+/g, ' ').trim() || 'General'
  return `Message ${name}…`
}

export interface AgentChatRef {
  id: string
  agentId: string
  updatedAt: number
}

export type AgentSwitch = { kind: 'stay' } | { kind: 'open'; id: string } | { kind: 'start' }

/**
 * Account-menu switch. Stay on the open chat when it already uses this agent.
 * Otherwise open that agent's latest chat, or start a new one. Never retitles.
 */
export function switchAgentChat(
  currentId: string | null,
  currentAgentId: string | null,
  nextAgentId: string,
  chats: readonly AgentChatRef[],
): AgentSwitch {
  if (currentId && currentAgentId === nextAgentId) return { kind: 'stay' }
  const latest = chats
    .filter((chat) => chat.agentId === nextAgentId)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0]
  if (latest) return { kind: 'open', id: latest.id }
  return { kind: 'start' }
}

export function agentFilterIds(
  agents: readonly { id: string; canChat: boolean }[],
  chats: readonly { agentId: string }[],
): string[] {
  const ids: string[] = []
  for (const agent of agents) {
    if (agent.canChat || chats.some((chat) => chat.agentId === agent.id)) ids.push(agent.id)
  }
  for (const chat of chats) {
    if (!ids.includes(chat.agentId)) ids.push(chat.agentId)
  }
  return ids
}
