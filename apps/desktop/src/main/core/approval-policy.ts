/**
 * Approval lives in the main process. The model cannot set a bypass flag.
 * Read is automatic. Send, modify, schedule, and create need one approval.
 * Delete needs two confirmations, and the second waits out a short countdown.
 * Deletes go to trash.
 */

export type ActionClass = 'read' | 'write' | 'delete'
export type ActionVerb = 'read' | 'send' | 'modify' | 'schedule' | 'create' | 'delete'

export interface ProposedAction {
  id: string
  connector: string
  class: ActionClass
  verb: ActionVerb
  summary: string
}

export interface AuditEntry {
  at: number
  id: string
  effect: string
}

const COUNTDOWN_MS = 5000

export function decide(action: { class: ActionClass; verb: ActionVerb }): { effect: 'allow' } | { effect: 'needs-approval' } | { effect: 'needs-double-confirm'; countdownSeconds: number } {
  if (action.class === 'read' || action.verb === 'read') return { effect: 'allow' }
  if (action.class === 'delete' || action.verb === 'delete') return { effect: 'needs-double-confirm', countdownSeconds: COUNTDOWN_MS / 1000 }
  return { effect: 'needs-approval' }
}

export class ApprovalGate {
  private pending = new Map<string, { action: ProposedAction; confirms: number; secondAt: number | null }>()
  readonly audit: AuditEntry[] = []

  submit(action: ProposedAction, now: number): { state: 'done' | 'needs-approval' | 'needs-second'; countdownSeconds?: number } {
    const decision = decide(action)
    this.audit.push({ at: now, id: action.id, effect: decision.effect })
    if (decision.effect === 'allow') return { state: 'done' }
    this.pending.set(action.id, { action, confirms: 0, secondAt: null })
    if (decision.effect === 'needs-approval') return { state: 'needs-approval' }
    return { state: 'needs-second', countdownSeconds: decision.countdownSeconds }
  }

  approve(id: string, now: number): { state: 'done' | 'needs-second' | 'wait' | 'missing'; countdownSeconds?: number } {
    const row = this.pending.get(id)
    if (!row) return { state: 'missing' }
    const decision = decide(row.action)
    if (decision.effect === 'needs-approval') {
      this.pending.delete(id)
      this.audit.push({ at: now, id, effect: 'approved' })
      return { state: 'done' }
    }
    if (decision.effect !== 'needs-double-confirm') return { state: 'missing' }
    if (row.confirms === 0) {
      row.confirms = 1
      row.secondAt = now + COUNTDOWN_MS
      this.audit.push({ at: now, id, effect: 'first-confirm' })
      return { state: 'needs-second', countdownSeconds: COUNTDOWN_MS / 1000 }
    }
    if (row.secondAt != null && now < row.secondAt) {
      this.audit.push({ at: now, id, effect: 'early-second' })
      return { state: 'wait', countdownSeconds: Math.ceil((row.secondAt - now) / 1000) }
    }
    this.pending.delete(id)
    this.audit.push({ at: now, id, effect: 'trashed' })
    return { state: 'done' }
  }

  has(id: string): boolean {
    return this.pending.has(id)
  }

  /** Latest proposal still waiting. Does not approve or delete. */
  current(now: number): {
    id: string
    connector: string
    verb: ActionVerb
    summary: string
    confirms: number
    state: 'needs-approval' | 'needs-second' | 'wait'
    countdownSeconds: number
  } | null {
    const rows = [...this.pending.values()]
    const row = rows[rows.length - 1]
    if (!row) return null
    const decision = decide(row.action)
    if (decision.effect === 'needs-approval') {
      return { id: row.action.id, connector: row.action.connector, verb: row.action.verb, summary: row.action.summary, confirms: row.confirms, state: 'needs-approval', countdownSeconds: 0 }
    }
    const wait = row.secondAt != null && now < row.secondAt
    return {
      id: row.action.id,
      connector: row.action.connector,
      verb: row.action.verb,
      summary: row.action.summary,
      confirms: row.confirms,
      state: wait ? 'wait' : 'needs-second',
      countdownSeconds: wait && row.secondAt != null ? Math.ceil((row.secondAt - now) / 1000) : 0,
    }
  }

  cancel(id: string, now: number): void {
    if (!this.pending.has(id)) return
    this.pending.delete(id)
    this.audit.push({ at: now, id, effect: 'cancelled' })
  }
}
