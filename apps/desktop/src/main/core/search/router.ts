/**
 * Local sources are consulted in a fixed order. Online runs only when those
 * sources are thin, the question is fresh, or a live figure or statute is required.
 */
import { classifyIntent, financeNeedsLive } from './intent.js'
import { LOCAL_LAYER_ORDER, type Intent, type LocalHit } from './types.js'

export function historyHits(messages: { role: string; text: string }[], question: string): LocalHit[] {
  const words = question.toLowerCase().split(/\W+/).filter((word) => word.length > 3)
  if (!words.length) return []
  const hits: LocalHit[] = []
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.text.trim()) continue
    const hay = message.text.toLowerCase()
    const score = words.filter((word) => hay.includes(word)).length / words.length
    if (score < 0.4) continue
    hits.push({
      layer: 'history',
      title: 'Earlier in this chat',
      text: message.text.slice(0, 800),
      url: '',
      pack: 'chat history',
      score,
    })
  }
  return hits.slice(0, 3)
}

export function pickLocal(hits: LocalHit[]): LocalHit | null {
  for (const layer of LOCAL_LAYER_ORDER) {
    const found = hits.filter((hit) => hit.layer === layer && hit.text.trim())
    if (!found.length) continue
    return found.sort((a, b) => b.score - a.score)[0]
  }
  return null
}

export interface RoutePlan {
  intent: Intent
  online: boolean
  reason: string
  local: LocalHit | null
}

export function planRoute(input: {
  question: string
  hits: LocalHit[]
  fresh: boolean
  online: boolean
  webAllowed: boolean
  offlineOnly: boolean
  legalQuoted: boolean
}): RoutePlan {
  const intent = classifyIntent(input.question)
  const local = pickLocal(input.hits)
  const can = input.online && input.webAllowed && !input.offlineOnly
  if (intent === 'finance' && financeNeedsLive(input.question)) {
    return { intent, local, online: can, reason: can ? 'live figure' : 'live figure needs a connection' }
  }
  if (intent === 'legal') {
    if (input.legalQuoted) return { intent, local, online: false, reason: 'local statute' }
    return { intent, local, online: can, reason: can ? 'statute not on this computer' : 'statute not on this computer' }
  }
  if (local && !input.fresh) return { intent, local, online: false, reason: `using ${local.layer}` }
  return { intent, local, online: can, reason: can ? 'local sources are thin' : 'web search is off' }
}
