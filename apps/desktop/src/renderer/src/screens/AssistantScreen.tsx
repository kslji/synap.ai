import { useEffect, useState } from 'react'
import type { AssistantDesk } from '../../../shared/ipc-contract'

export function AssistantScreen({ mode }: { mode: 'connectors' | 'approval' | 'delete' | 'google' | 'outbox' | 'invoice' }) {
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
          : mode === 'google'
            ? await window.surf.assistant.connect('google')
            : mode === 'outbox'
              ? await window.surf.assistant.showOutbox()
              : mode === 'invoice'
                ? await window.surf.assistant.showInvoice()
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
          <p className="mt-1 text-sm text-[var(--muted)]">Mail stays on this computer. Sign-in uses the system browser and a loopback redirect. Sends wait for Approve.</p>
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
                <span className="pill pill-muted" data-connected={row.connected ? 'yes' : 'no'}>{row.connected ? `Connected${row.account ? ` · ${row.account}` : ''}` : 'Not connected'}</span>
              </div>
              {row.id === 'gmail' && !row.connected && (
                <button type="button" className="btn btn-primary mt-3" data-google-connect="yes" onClick={() => { void refresh(window.surf.assistant.connect('google')) }}>Connect Google</button>
              )}
            </article>
          ))}
        </div>
        {desk?.notice && <p className="text-sm text-[var(--muted)]">{desk.notice}</p>}
        {(mode === 'outbox' || (desk?.outbox.length ?? 0) > 0) && mode !== 'approval' && mode !== 'delete' && (
          <article className="card px-5 py-4" data-outbox="yes">
            <h2 className="text-lg font-semibold">Outbox</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{desk?.loginAtStart ? 'Surf will open at login to send what you already approved.' : 'Approved mail waits here until it can be sent.'}</p>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {(desk?.outbox ?? []).map((item) => (
                <li key={item.id} data-outbox-item={item.status}>{item.summary} · {item.status} · {item.when}</li>
              ))}
            </ul>
            {mode === 'outbox' && desk?.pending && (
              <button type="button" className="btn btn-primary mt-3" onClick={() => { if (desk.pending) void refresh(window.surf.assistant.approve(desk.pending.id)) }}>Approve</button>
            )}
          </article>
        )}
        {mode === 'invoice' && (
          <article className="card px-5 py-4" data-invoice-pdf="yes">
            <h2 className="text-lg font-semibold">Invoice {desk?.invoice?.number ?? ''}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">{desk?.invoice ? `${desk.invoice.template} · total ${desk.invoice.total} · PDF ${desk.invoice.pdfBytes} bytes` : 'Preparing the PDF.'}</p>
            <p className="mt-3 text-sm">The PDF, DOCX, and spreadsheet use the same totals. Emailing the PDF waits for Approve.</p>
          </article>
        )}
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
