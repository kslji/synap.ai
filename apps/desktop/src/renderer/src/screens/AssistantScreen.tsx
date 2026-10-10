import { useEffect, useState } from 'react'
import type { AssistantDesk } from '../../../shared/ipc-contract'

export function AssistantScreen({ mode }: { mode: 'connectors' | 'approval' | 'delete' }) {
  const [desk, setDesk] = useState<AssistantDesk | null>(null)
  const [summary, setSummary] = useState('Reply to Ada: The berth is North.')
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let cancel = false
    const run = async () => {
      const next = mode === 'approval'
        ? await window.surf.assistant.draft('Reply to Ada: The berth is North.')
        : mode === 'delete'
          ? await window.surf.assistant.armDelete()
          : await window.surf.assistant.desk()
      if (!cancel) setDesk(next)
    }
    void run().catch((error: unknown) => { if (!cancel) setNote((error as Error).message) })
    return () => { cancel = true }
  }, [mode])

  useEffect(() => {
    if (!desk?.pending || desk.pending.countdownSeconds <= 0) return
    const timer = window.setTimeout(() => {
      void window.surf.assistant.desk().then(setDesk).catch(() => undefined)
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [desk])

  async function refresh(next: Promise<AssistantDesk>) {
    setDesk(await next)
  }

  const pending = desk?.pending ?? null
  const deleteArmed = mode === 'delete' && pending?.verb === 'delete'
  const secondLocked = deleteArmed && pending.confirms >= 1 && pending.countdownSeconds > 0

  return (
    <section className="flex-1 overflow-auto px-8 py-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Connectors stay on this computer. Nothing here is signed in to Google, Microsoft, or Slack yet.</p>
        </div>
        {note && <p className="text-sm text-[var(--danger)]">{note}</p>}
        <div className="flex flex-col gap-3">
          {(desk?.connectors ?? []).map((row) => (
            <article key={row.id} className="card px-5 py-4" data-connector={row.id}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{row.name}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{row.detail}</p>
                </div>
                <span className="pill pill-muted">Not connected</span>
              </div>
            </article>
          ))}
        </div>
        {mode === 'approval' && (
          <article className="card px-5 py-4" data-approval-card={pending?.state ?? 'none'}>
            <h2 className="text-lg font-semibold">Reply preview</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Sample inbox. The message body was filtered before it was shown. Sending needs Approve.</p>
            <p className="mt-3 text-sm">{desk?.inbox[0] ? `${desk.inbox[0].from}: ${desk.inbox[0].body}` : 'No sample message.'}</p>
            <textarea className="field mt-3" value={summary} onChange={(event) => setSummary(event.target.value)} aria-label="Reply draft" />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => { void refresh(window.surf.assistant.draft(summary)) }}>Edit</button>
              <button type="button" className="btn btn-primary" disabled={!pending || pending.verb === 'delete'} onClick={() => { if (pending) void refresh(window.surf.assistant.approve(pending.id)) }}>Approve</button>
              <button type="button" className="btn btn-ghost" disabled={!pending} onClick={() => { if (pending) void refresh(window.surf.assistant.cancel(pending.id)) }}>Cancel</button>
            </div>
            {desk && desk.sent.length > 0 && <p className="mt-2 text-sm">Sent on this computer: {desk.sent.length}</p>}
          </article>
        )}
        {mode === 'delete' && (
          <article className="card px-5 py-4" data-delete-confirm={secondLocked ? 'locked' : 'open'}>
            <h2 className="text-lg font-semibold">Move this message to trash?</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Delete needs two confirmations. The second button waits five seconds. Surf moves the sample message to trash. It does not permanently delete it.</p>
            <p className="mt-3 text-sm">{desk?.inbox[0]?.subject ?? 'Berth tonight'}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!deleteArmed || secondLocked}
                onClick={() => { if (pending) void refresh(window.surf.assistant.approve(pending.id)) }}
              >
                {pending && pending.confirms < 1 ? 'Continue' : secondLocked ? `Move to trash in ${pending.countdownSeconds}s` : 'Move to trash'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => { if (pending) void refresh(window.surf.assistant.cancel(pending.id)) }}>Cancel</button>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
