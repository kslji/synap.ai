export type AgentStatus = 'available' | 'beta' | 'coming soon'

export interface AgentMeta {
  id: string
  name: string
  tagline: string
  description: string
  icon: string
  accent: string
  status: AgentStatus
  order: number
  notes?: string
}

const STATUSES = new Set<AgentStatus>(['available', 'beta', 'coming soon'])

export function parseAgentFile(id: string, raw: unknown): AgentMeta {
  if (!id || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) throw new Error(`agent id is not a folder name: ${id}`)
  if (!raw || typeof raw !== 'object') throw new Error(`agent ${id} is not an object`)
  const row = raw as Record<string, unknown>
  const name = requiredString(row.name, id, 'name')
  const tagline = requiredString(row.tagline, id, 'tagline')
  const description = requiredString(row.description, id, 'description')
  const status = requiredString(row.status, id, 'status')
  if (!STATUSES.has(status as AgentStatus)) throw new Error(`agent ${id} has an unknown status`)
  const order = row.order
  if (typeof order !== 'number' || !Number.isFinite(order)) throw new Error(`agent ${id} is missing order`)
  const notes = row.notes == null ? undefined : requiredString(row.notes, id, 'notes')
  return {
    id,
    name,
    tagline,
    description,
    icon: typeof row.icon === 'string' && row.icon.trim() ? row.icon.trim() : 'spark',
    accent: typeof row.accent === 'string' && row.accent.trim() ? row.accent.trim() : '#F97316',
    status: status as AgentStatus,
    order,
    notes,
  }
}

export function sortAgents(agents: AgentMeta[]): AgentMeta[] {
  return [...agents].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** Website download link. Coming soon and beta stay on the card there. */
export function agentCanOpen(agent: AgentMeta): boolean {
  return agent.status === 'available'
}

/** Desktop Start chat. Coming soon stays on the card. Beta can keep its own chats. */
export function agentCanChat(agent: AgentMeta): boolean {
  return agent.status === 'available' || agent.status === 'beta'
}

function requiredString(value: unknown, id: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`agent ${id} is missing ${field}`)
  return value.trim()
}
