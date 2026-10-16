import { useState } from 'react'

/** Shown only when the main process reports dev web search. Packaged builds omit it. */
export function DevWebPanel({ apiUrl }: { apiUrl: string }) {
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(tool: 'web_search' | 'fetch_page') {
    setBusy(true)
    try {
      const res = await window.surf.devWeb.run(tool === 'web_search' ? { tool, query } : { tool, url })
      setOut(res.text)
    } catch (error) {
      setOut((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card px-4 py-4" data-dev-web="yes">
      <div className="text-sm font-semibold">Dev web search</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
        This build talks to {apiUrl}. Sign-in and search quotas are skipped. Set SYNAP_API_URL to use another address.
        In chat, type /web and a query, or /fetch and one https address.
      </p>
      <label className="mt-3 block text-sm">
        <span className="font-semibold text-[var(--ink)]">Search</span>
        <input
          className="field mt-2"
          value={query}
          spellCheck={false}
          aria-label="Dev web search query"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <button className="btn btn-primary mt-3" type="button" disabled={busy || !query.trim()} onClick={() => { void run('web_search') }}>
        Search
      </button>
      <label className="mt-4 block text-sm">
        <span className="font-semibold text-[var(--ink)]">Page</span>
        <input
          className="field mt-2"
          value={url}
          spellCheck={false}
          aria-label="Dev page address"
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value.trim())}
        />
      </label>
      <button className="btn btn-ghost mt-3" type="button" disabled={busy || !url} onClick={() => { void run('fetch_page') }}>
        Fetch page
      </button>
      {out && <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap text-sm" data-dev-web-output="yes">{out}</pre>}
    </div>
  )
}
