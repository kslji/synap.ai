import type { UpdateOffer } from '../../../shared/ipc-contract'

export function UpdateBanner({ offer, onApply }: { offer: UpdateOffer; onApply: () => void }) {
  return (
    <aside className="border-b border-[var(--line)] bg-[var(--accent-soft)] px-4 py-3" data-update-banner="yes">
      <div className="mx-auto flex max-w-3xl flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Update available · {offer.version}</p>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            {offer.kind === 'manual'
              ? 'This Mac build is unsigned, so Surf cannot replace itself. Download the new disk image and move it to Applications.'
              : 'Surf can download the Windows installer and replace this copy.'}
          </p>
          {offer.kind === 'manual' && (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[var(--muted)]">
              {offer.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          )}
        </div>
        <button className="btn btn-primary" type="button" data-update-apply="yes" onClick={onApply}>
          {offer.kind === 'manual' ? 'Download .dmg' : 'Download and install'}
        </button>
      </div>
    </aside>
  )
}
