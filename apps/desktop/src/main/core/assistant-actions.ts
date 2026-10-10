/**
 * Connector actions go through the approval gate. A send stays in the outbox until approved.
 * A delete is moved to trash only after the second confirmation. Mail text is filtered first.
 */
import { ApprovalGate, type ProposedAction } from './approval-policy.js'
import { cleanUntrusted } from './code-tools.js'

export interface Mail {
  id: string
  from: string
  subject: string
  body: string
}

export interface Mailbox {
  inbox: Mail[]
  sent: Mail[]
  trash: Mail[]
  outbox: ProposedAction[]
}

export function visibleMail(mail: Mail): Mail {
  return { ...mail, body: cleanUntrusted(mail.body) }
}

export function readMail(box: Mailbox, id: string, gate: ApprovalGate, now: number): { applied: boolean; body: string } {
  const action: ProposedAction = { id: `read-${id}`, connector: 'gmail', class: 'read', verb: 'read', summary: `Read ${id}` }
  const decision = gate.submit(action, now)
  const mail = box.inbox.find((item) => item.id === id)
  return { applied: decision.state === 'done', body: mail ? visibleMail(mail).body : '' }
}

export function queueSend(box: Mailbox, action: ProposedAction, gate: ApprovalGate, now: number): { applied: boolean; state: string } {
  const decision = gate.submit(action, now)
  if (decision.state !== 'done') {
    box.outbox.push(action)
    return { applied: false, state: decision.state }
  }
  return { applied: true, state: 'done' }
}

export function approveSend(box: Mailbox, id: string, gate: ApprovalGate, now: number, mail: Mail): { applied: boolean; state: string } {
  const decision = gate.approve(id, now)
  if (decision.state !== 'done') return { applied: false, state: decision.state }
  box.outbox = box.outbox.filter((item) => item.id !== id)
  box.sent.push(mail)
  return { applied: true, state: 'done' }
}

export function deleteMail(box: Mailbox, id: string, gate: ApprovalGate, now: number): { applied: boolean; state: string } {
  const action: ProposedAction = { id, connector: 'gmail', class: 'delete', verb: 'delete', summary: `Delete ${id}` }
  if (!gate.has(id)) {
    const decision = gate.submit(action, now)
    return { applied: false, state: decision.state }
  }
  const decision = gate.approve(id, now)
  if (decision.state !== 'done') return { applied: false, state: decision.state }
  const mail = box.inbox.find((item) => item.id === id)
  box.inbox = box.inbox.filter((item) => item.id !== id)
  if (mail) box.trash.push(mail)
  return { applied: true, state: 'trashed' }
}
