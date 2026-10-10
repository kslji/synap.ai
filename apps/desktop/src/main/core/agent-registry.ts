/**
 * Agent cards live in agents/<id>/agent.json. The main process loads them.
 * The renderer asks for the list over IPC. Model ids are registry ids, picked by RAM tier.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AgentCard {
  id: string
  name: string
  description: string
  scope: string[]
  outOfScope: string[]
  systemPrompt: string
  models: Record<'0' | '1' | '2' | '3', string>
  tools: string[]
  retrieval: 'documents' | 'code' | 'mail'
  harnessSuite: string
  thresholds: { minScore: number }
  home: boolean
  note?: string
}

export function resolveAgentsDir(candidates: string[]): string {
  const found = candidates.find((dir) => existsSync(join(dir, 'general', 'agent.json')))
  if (!found) throw new Error('agent cards were not found')
  return found
}

const TRADING = /\b(hft|high[- ]frequency trading|algorithmic trading|trading bot|market[- ]making|order[- ]book scalp\w*|crypto trading|stock trading)\b/i
const COLD = /\b(cold[- ]emails?|email campaigns?|cold outreach|mass emails?|email blasts?)\b/i

export function loadAgents(dir: string): AgentCard[] {
  const cards: AgentCard[] = []
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'agent.json')
    const card = JSON.parse(readFileSync(file, 'utf8')) as AgentCard
    if (!card.id || !card.systemPrompt || !card.models['0']) throw new Error(`agent ${name} is incomplete`)
    cards.push(card)
  }
  return cards.sort((a, b) => a.name.localeCompare(b.name))
}

export function agentById(cards: AgentCard[], id: string): AgentCard {
  return cards.find((card) => card.id === id) ?? cards.find((card) => card.id === 'general') ?? cards[0]
}

export function modelIdFor(card: AgentCard, tier: 0 | 1 | 2 | 3): string {
  return card.models[String(tier) as '0' | '1' | '2' | '3']
}

/** Code + UI refuses trading work before the model is asked. */
export function tradingRefusal(text: string): string | null {
  if (!TRADING.test(text) || /\btrade-offs?\b/i.test(text)) return null
  return "I can't help with high-frequency trading or trading systems. Code + UI is for product and SaaS engineering. I can help with architecture, application code, and interface work."
}

/** Assistant refuses cold campaigns before the model is asked. */
export function coldEmailRefusal(text: string): string | null {
  if (!COLD.test(text)) return null
  return "I can't help with cold email campaigns. Assistant can draft a reply to someone who wrote to you, and it can send an invoice you approve."
}
