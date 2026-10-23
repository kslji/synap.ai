/**
 * Item 12: what an Online turn may carry from this chat's own history.
 *
 * The gate is per message, not per turn. A row whose mode is 'online' has already
 * been through the gateway, so reusing it discloses nothing new. A row that stayed
 * on the device - and a row written before the mode column existed, which the store
 * reads as offline - only goes once the chat has given consent (see
 * code-agent/online-consent.ts for the flag itself, which is stored per chat).
 *
 * Note rows are product chrome ("Online may now use this chat's Offline replies")
 * and never become model context.
 */
import type { StoredMessage } from '../../shared/ipc-contract'

/** The four fields that decide whether a thread row may leave the device. */
export type ContextRow = Pick<StoredMessage, 'id' | 'role' | 'text' | 'mode'>

/** Rows carried into one online turn. Long threads stay inside the gateway's window. */
export const ONLINE_CONTEXT_LIMIT = 12

/** Written into the thread when the chat agrees, and when it takes the agreement back. */
export const ONLINE_CONSENT_ON_NOTE = 'Online may now use this chat’s Offline replies as context. Turn it off on the chip above the composer.'
export const ONLINE_CONSENT_OFF_NOTE = 'Online no longer uses this chat’s Offline replies. It only sees what you send in each turn.'

/**
 * The history an online turn may carry: everything once the chat consents, and
 * only the rows that already went online when it has not. Rows the user pinned
 * for this turn are left out - the pinned block already carries them.
 */
export function onlineContextTurns(
  rows: readonly ContextRow[],
  consented: boolean,
  alreadyPinned: readonly string[] = [],
): ContextRow[] {
  const pinned = new Set(alreadyPinned)
  const usable = rows.filter((row) => (row.role === 'user' || row.role === 'assistant') && !pinned.has(row.id))
  const allowed = consented ? usable : usable.filter((row) => row.mode === 'online')
  return allowed.slice(-ONLINE_CONTEXT_LIMIT)
}

/** Label the block so the model (and anyone reading the log) knows what it is. */
export function renderOnlineContext(rows: readonly ContextRow[]): string {
  if (!rows.length) return ''
  const carriedOffline = rows.some((row) => row.mode !== 'online')
  const header = carriedOffline
    ? 'Earlier messages from this chat. Offline context included because you allowed it for this chat:'
    : 'Earlier messages from this chat that already went through the gateway:'
  const lines = rows.map((row) => `[${row.role} ${(row.mode ?? 'offline').toUpperCase()}]\n${row.text}`)
  return `${header}\n\n${lines.join('\n\n')}`
}

/** Thread history without the chrome: what the local model pairs into turns. */
export function conversationTurnRows<T extends { role: string }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.role !== 'note')
}
