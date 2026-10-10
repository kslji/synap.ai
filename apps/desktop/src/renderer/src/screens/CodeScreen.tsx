import { useEffect, useState, type FormEvent } from 'react'
import type { LicenseNote, SymbolHit } from '../../../shared/ipc-contract'
import { previewDocument } from '../../../shared/preview-doc'
import { reactPreviewDocument } from '../../../shared/react-preview'

const STARTER = `<style>
  body { margin: 0; font-family: sans-serif; background: #fafafa; color: #111; }
  .card { margin: 24px; max-width: 360px; border: 1px solid #e7e5e4; border-radius: 16px; padding: 20px; }
  button { background: #f97316; color: #111; border: 0; border-radius: 999px; padding: 10px 16px; font-weight: 700; }
</style>
<div class="card">
  <h1>Harbor booking</h1>
  <p>Pier 4 · leaves 06:40</p>
  <button>Reserve</button>
</div>`

const REACT_STARTER = `function Harbor() {
  return <div className="card"><h1>Harbor booking</h1><p>Pier 4 · leaves 06:40</p></div>
}`

const BEFORE = 'export function ferryLeave() {\n  return "06:40"\n}\n'
const AFTER = 'export function ferryLeave() {\n  return "07:00"\n}\n'

const CHIPS = [
  'Write the HLD and a Mermaid diagram for a booking service.',
  'Review this handler for OWASP and performance issues.',
  'Generate tests for ferryLeave.',
  'Explain this regex and a safer version.',
  'Write a SQL query that lists open invoices.',
  'Write a commit message for the ferry time change.',
]

export function CodeScreen({
  tab,
  onTab,
  onAsk,
  kind = 'html',
}: {
  tab: 'preview' | 'architecture'
  onTab: (tab: 'preview' | 'architecture') => void
  onAsk: (text: string) => void
  kind?: 'html' | 'react' | 'python'
}) {
  const [source, setSource] = useState(kind === 'react' ? REACT_STARTER : STARTER)
  const [symbols, setSymbols] = useState<SymbolHit[]>([])
  const [query, setQuery] = useState('ferryLeave')
  const [runText, setRunText] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  const [licenses, setLicenses] = useState<LicenseNote[]>([])
  const [diffNote, setDiffNote] = useState<string | null>(null)
  const [editor, setEditor] = useState('export function ferryLeave() {\n  ')
  const [ghost, setGhost] = useState('')
  const doc = kind === 'react' ? reactPreviewDocument(source) : previewDocument(source)

  useEffect(() => {
    if (kind !== 'python') return
    void window.surf.code.run('python', 'print(2 + 2)').then((result) => {
      setRunText(result.executed ? `Python sandbox: ${result.result}` : (result.error ?? 'Not executed'))
    }).catch((error: unknown) => setRunText((error as Error).message))
  }, [kind])

  useEffect(() => {
    void window.surf.code.search('ferryLeave').then(setSymbols).catch(() => undefined)
  }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    setSymbols(await window.surf.code.search(query))
  }

  async function attach() {
    const picked = await window.surf.code.attach()
    if (!picked) return
    setFolder(picked.root)
    setLicenses(await window.surf.code.licenses())
    setSymbols(await window.surf.code.search(query))
  }

  async function run() {
    const result = await window.surf.code.run('javascript', 'return 2 + 2')
    setRunText(result.executed ? `JavaScript sandbox: ${result.result}` : (result.error ?? 'Not executed'))
  }

  async function decide(approved: boolean) {
    const proposal = await window.surf.code.propose('sample/harbor.ts', BEFORE, AFTER)
    const result = await window.surf.code.apply(proposal.id, approved)
    setDiffNote(result.note)
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-auto px-8 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Code + UI</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Product and SaaS engineering. JavaScript and Python run in a sandbox. Symbol search stays on this computer. The retrieval bake-off picked EmbeddingGemma over BM25.</p>
        </div>
        <span className="pill pill-warn">Not for trading or HFT.</span>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className={`btn ${tab === 'preview' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onTab('preview')}>Preview</button>
        <button type="button" className={`btn ${tab === 'architecture' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onTab('architecture')}>Architecture</button>
      </div>
      {tab === 'preview' ? (
        <div className="mt-4 grid min-h-0 gap-4 lg:grid-cols-2">
          <textarea className="field min-h-[280px] font-mono text-xs" value={source} onChange={(event) => setSource(event.target.value)} aria-label="Preview source" />
          <iframe title="Live preview" sandbox={doc.sandbox} srcDoc={doc.srcdoc} data-preview-frame="yes" data-react-preview={kind === 'react' ? 'yes' : 'no'} className="min-h-[280px] w-full rounded-xl border border-[var(--line)] bg-white" />
        </div>
      ) : (
        <article className="card mt-4 px-5 py-4" data-architecture="yes">
          <h2 className="text-lg font-semibold">Harbor booking · HLD</h2>
          <p className="mt-2 text-sm leading-relaxed">The browser talks only to the booking API. The API writes reservations and reads the pier timetable. Payments stay behind the API.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="card px-3 py-2">Browser</span>
            <span className="text-[var(--muted)]">→</span>
            <span className="card px-3 py-2">Booking API</span>
            <span className="text-[var(--muted)]">→</span>
            <span className="card px-3 py-2">Reservations</span>
          </div>
          <pre className="mt-4 overflow-auto rounded-xl bg-[var(--bg)] p-3 text-xs">{`flowchart LR
  Browser --> API[Booking API]
  API --> DB[(Reservations)]`}</pre>
          <h3 className="mt-4 text-sm font-semibold">ADR</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">Keep the timetable read-only in this service. A later service can own pricing. Do not put order-book or trading logic here.</p>
        </article>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {CHIPS.map((chip) => (
          <button key={chip} type="button" className="btn btn-ghost" onClick={() => onAsk(chip)}>{chip}</button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => { void run() }}>Run JavaScript</button>
        <button type="button" className="btn btn-ghost" data-python-run="yes" onClick={() => { void window.surf.code.run('python', 'print(2 + 2)').then((result) => setRunText(result.executed ? `Python sandbox: ${result.result}` : (result.error ?? 'Not executed'))) }}>Run Python</button>
        <button type="button" className="btn btn-ghost" onClick={() => { void attach() }}>Attach a project folder</button>
        {runText && <span className="text-sm text-[var(--muted)]" data-python-result={kind === 'python' ? 'yes' : 'no'}>{runText}</span>}
        {folder && <span className="text-sm text-[var(--muted)]">{folder}</span>}
      </div>
      <form className="mt-4 flex gap-2" onSubmit={(event) => { void search(event) }}>
        <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Symbol search" />
        <button type="submit" className="btn btn-ghost">Symbols</button>
      </form>
      <ul className="mt-2 text-sm">
        {symbols.slice(0, 4).map((hit) => (
          <li key={`${hit.path}:${hit.name}`} className="py-1"><span className="font-semibold">{hit.name}</span> <span className="text-[var(--muted)]">{hit.path}</span></li>
        ))}
      </ul>
      {licenses.length > 0 && (
        <ul className="mt-2 text-sm">
          {licenses.slice(0, 6).map((note) => (
            <li key={note.path}>{note.name}: {note.license} {note.allowed ? '' : '(outside Apache-2.0 and MIT)'}</li>
          ))}
        </ul>
      )}
      <article className="card mt-4 px-5 py-4" data-diff-card="yes">
        <h2 className="text-sm font-semibold">Diff · sample/harbor.ts</h2>
        <pre className="mt-2 overflow-auto text-xs">{`--- ferryLeave\n+++ ferryLeave\n-  return "06:40"\n+  return "07:00"`}</pre>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => { void decide(false) }}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => { void decide(true) }}>Approve</button>
        </div>
        {diffNote && <p className="mt-2 text-sm text-[var(--muted)]">{diffNote}</p>}
      </article>
      <label className="mt-4 block text-sm font-semibold" htmlFor="fim-editor">Inline suggestion</label>
      <textarea id="fim-editor" className="field mt-2 min-h-[88px] font-mono text-xs" value={editor} aria-label="Code editor" onChange={(event) => {
        const value = event.target.value
        setEditor(value)
        void window.surf.code.complete(value, '\n}').then((result) => setGhost(result.text || result.reason)).catch(() => undefined)
      }} />
      {ghost && <p className="mt-2 text-sm text-[var(--muted)]" data-fim-suggestion="yes">{ghost}</p>}
    </section>
  )
}
