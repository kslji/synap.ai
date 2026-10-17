import { useEffect } from 'react'
import type { PackRow } from '../../../shared/ipc-contract'

export function PacksScreen({
  packs,
  busy,
  syncOff = false,
  error,
  onSync,
  onRemove,
  onRefresh,
}: {
  packs: PackRow[]
  busy: boolean
  syncOff?: boolean
  error: string | null
  onSync: () => void
  onRemove: (id: string) => void
  onRefresh?: () => void
}) {
  const indexing = packs.some((pack) => pack.indexState === 'indexing')
  useEffect(() => {
    if (!indexing || !onRefresh) return
    const timer = setInterval(onRefresh, 1500)
    return () => clearInterval(timer)
  }, [indexing, onRefresh])
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="packs">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Knowledge packs</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{syncOff ? 'Dev mode, sync off.' : 'Signed packs stay on this computer after they install. Sync runs when you are online and signed in.'}</p>
          </div>
          <button className="btn btn-primary shrink-0" type="button" disabled={busy || syncOff} data-packs-sync="yes" onClick={onSync}>
            {busy ? 'Syncing' : 'Check for updates'}
          </button>
        </div>
        {error && <p className="text-sm text-[var(--muted)]">{error}</p>}
        {packs.length === 0 && (
          <div className="card px-4 py-4 text-sm text-[var(--muted)]">No packs yet. Sign in, then check for updates.</div>
        )}
        {packs.map((pack) => (
          <article key={pack.id} className="card px-4 py-4" data-pack-id={pack.id} data-pack-update={pack.updateAvailable ? 'yes' : 'no'}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">{pack.title}</div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {pack.niche}
                  {pack.version ? ` · installed ${pack.version}` : ' · not installed'}
                  {pack.latestVersion && pack.latestVersion !== pack.version ? ` · latest ${pack.latestVersion}` : ''}
                </p>
                {pack.sizeBytes != null && (
                  <p className="mt-1 text-xs text-[var(--muted)]" data-pack-size="yes">{formatBytes(pack.sizeBytes)}</p>
                )}
                {pack.updatedAt && (
                  <p className="mt-1 text-xs text-[var(--muted)]" data-pack-updated="yes">Updated {pack.updatedAt.slice(0, 10)}</p>
                )}
                {pack.syncedAt && !pack.updatedAt && (
                  <p className="mt-1 text-xs text-[var(--muted)]">Last synced {new Date(pack.syncedAt).toLocaleString()}</p>
                )}
              </div>
              {pack.updateAvailable && <span className="pill">Update</span>}
            </div>
            {pack.progress != null && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elev)]">
                <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(pack.progress * 100)}%` }} />
              </div>
            )}
            {pack.note && <p className="mt-2 text-sm text-[var(--muted)]" data-pack-note="yes">{pack.note}</p>}
            {pack.indexState && (
              <p className="mt-2 text-xs text-[var(--muted)]" data-pack-index={pack.indexState}>{indexLabel(pack)}</p>
            )}
            {pack.indexState === 'indexing' && pack.indexProgress != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elev)]" data-pack-index-bar="yes">
                <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.round(pack.indexProgress * 100)}%` }} />
              </div>
            )}
            {pack.sources && pack.sources.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-xs text-[var(--muted)]" data-pack-sources="yes">
                {pack.sources.map((source) => (
                  <li key={`${source.title}-${source.version}`}>
                    {source.title} {source.version} · {source.licence}
                  </li>
                ))}
              </ul>
            )}
            {pack.error && <p className="mt-2 text-sm text-[var(--muted)]">{pack.error}</p>}
            <div className="mt-3 flex gap-2">
              {(!pack.installed || pack.updateAvailable) && (
                <button className="btn btn-primary" type="button" disabled={busy || syncOff} onClick={onSync}>
                  {pack.installed ? 'Install update' : 'Install'}
                </button>
              )}
              {pack.installed && (
                <button className="btn btn-ghost" type="button" onClick={() => onRemove(pack.id)}>Remove</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function indexLabel(pack: PackRow): string {
  if (pack.indexState === 'ready') return 'Embeddings are cached on this computer.'
  if (pack.indexState === 'indexing') {
    const pct = pack.indexProgress == null ? 0 : Math.round(pack.indexProgress * 100)
    return `Building embeddings on this computer: ${pct}%`
  }
  if (pack.indexState === 'off') return 'EmbeddingGemma is not downloaded, so search uses the keyword index only.'
  if (pack.indexState === 'blocked') return 'Embeddings wait until the pack can be opened.'
  if (pack.indexState === 'error') return 'The embedding index stopped.'
  return 'Keyword index is ready. Embeddings have not been built on this computer yet.'
}
