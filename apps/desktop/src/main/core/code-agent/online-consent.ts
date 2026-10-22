/**
 * Per-chat consent for sending this conversation's earlier OFFLINE turns online.
 *
 * Product rule: chat history lives on the device, and an online turn reuses prior
 * offline context only when the user has agreed for that specific chat. The flag is
 * stored on device (next to the other code-agent state), never on the server, and
 * defaults to "not agreed" - so an online code turn sees the current task, the
 * project rules and its own tool observations, but none of the earlier offline
 * replies, until consent is given.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type OnlineConsentMap = Record<string, boolean>

const FILE = 'online-context-consent.json'

/** Only an explicit `true` counts as consent. Anything else is no consent. */
export function readOnlineConsent(dir: string): OnlineConsentMap {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, FILE), 'utf8')) as Record<string, unknown>
    const map: OnlineConsentMap = {}
    for (const [conversationId, value] of Object.entries(parsed)) {
      if (value === true) map[conversationId] = true
    }
    return map
  } catch {
    return {}
  }
}

export function writeOnlineConsent(dir: string, map: OnlineConsentMap): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, FILE), JSON.stringify(map), { mode: 0o600 })
}

/** Does this conversation allow its prior offline turns to go to a cloud model? */
export function onlineContextAllowed(map: OnlineConsentMap, conversationId: string): boolean {
  return map[conversationId] === true
}

export function withOnlineConsent(map: OnlineConsentMap, conversationId: string, allowed: boolean): OnlineConsentMap {
  const next: OnlineConsentMap = { ...map }
  if (allowed) next[conversationId] = true
  else delete next[conversationId]
  return next
}

/**
 * The history an online code turn may use: the whole conversation once the chat has
 * consented, nothing from earlier turns before that. The loop builds the task, the
 * project rules and this turn's tool observations itself, so an empty list here is
 * still a complete agent turn - just one that has never seen the offline chat.
 */
export function gatedHistory<T>(history: readonly T[], allowed: boolean): T[] {
  return allowed ? [...history] : []
}
