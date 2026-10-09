import type { PackRow } from '../../../shared/ipc-contract'

export function PacksScreen({
  packs,
  busy,
  error,
  onSync,
  onRemove,
}: {
  packs: PackRow[]
  busy: boolean
  error: string | null
  onSync: () => void
  onRemove: (id: string) => void
}) {
  return (
    <section className="flex-1 overflow-auto px-8 py-8" data-screen="packs">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Knowledge packs</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Signed packs stay on this computer after they install. Sync runs when you are online and signed in.</p>
          </div>
          <button className="btn btn-primary shrink-0" type="button" disabled={busy} data-packs-sync="yes" onClick={onSync}>
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
                {pack.syncedAt && (
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
            {pack.error && <p className="mt-2 text-sm text-[var(--muted)]">{pack.error}</p>}
            <div className="mt-3 flex gap-2">
              {(!pack.installed || pack.updateAvailable) && (
                <button className="btn btn-primary" type="button" disabled={busy} onClick={onSync}>
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
