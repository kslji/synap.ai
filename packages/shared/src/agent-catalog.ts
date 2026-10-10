import { parseAgentFile, sortAgents, type AgentMeta } from './agents'

const modules = import.meta.glob('../../../agents/*/agent.json', { eager: true, import: 'default' }) as Record<string, unknown>

export function agentsFromModules(modules: Record<string, unknown>): AgentMeta[] {
  return sortAgents(Object.entries(modules).map(([path, raw]) => {
    const id = path.split('/').filter(Boolean).slice(-2, -1)[0] ?? ''
    return parseAgentFile(id, raw)
  }))
}

export const agents: AgentMeta[] = agentsFromModules(modules)
