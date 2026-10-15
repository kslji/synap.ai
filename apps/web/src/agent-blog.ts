import { loadAgentPosts, type AgentPost } from './agent-posts'

const modules = import.meta.glob('../../../agents/*/blog/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

export const agentPosts: AgentPost[] = loadAgentPosts(modules)
