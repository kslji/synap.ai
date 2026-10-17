import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Display name from agents/<id>/agent.json. Null when that folder is not on disk. */
export function readAgentName(agentId: string, roots: readonly string[]): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(agentId)) return null
  for (const root of roots) {
    try {
      const raw = JSON.parse(readFileSync(join(root, agentId, 'agent.json'), 'utf8')) as { name?: unknown }
      if (typeof raw.name === 'string' && raw.name.trim()) return raw.name.trim().slice(0, 40)
    } catch {
      // This root has no folder for the id.
    }
  }
  return null
}
