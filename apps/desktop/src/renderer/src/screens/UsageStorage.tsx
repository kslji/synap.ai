import { useEffect, useState } from 'react'
import type { ModelStatus, SettingsPatch, StorageCategoryId, StorageReport, UsageReport } from '../../../shared/ipc-contract'
import { formatIndexBytes } from '../format'

const REASONS: Record<string, string> = {
  on: 'Speculative decoding is on. The draft model runs next to the main model.',
  off: 'Speculative decoding is off.',
  runtime: 'This llama.cpp build has no draft-model flag, so speculative decoding stays off.',
  missing: 'The Qwen 0.6B draft is not installed. Nothing is downloaded until you ask.',
  ram: 'This computer does not have room for the main model and a draft together, so speculative decoding stays off.',
}

export function LiveFeelSettings({
  status,
  settings,
  onPatch,
  onDownload,
}: {
  status: ModelStatus
  settings: Required<SettingsPatch>
  onPatch: (patch: SettingsPatch) => void
  onDownload: (id: string) => void
}) {
  const live = status.live
  const [minutes, setMinutes] = useState(String(settings.idleUnloadMinutes))
  useEffect(() => { setMinutes(String(settings.idleUnloadMinutes)) }, [settings.idleUnloadMinutes])
  const reason = live ? REASONS[live.speculativeReason] ?? REASONS.off : 'Checking this computer.'
  return (
    <div className="card px-4 py-4" data-live-feel="yes">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Keep the model loaded</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Load the selected model when Synap.surf opens, when it fits this computer. Qwen stays on 2B, 4B, or 9B for the laptop. Gemma 4 is used only when you picked it and the file fits: 2 GB on a 4 GB laptop, 3 GB on 8 GB, 4 GB on 16 GB, 8 GB on 32 GB.
            {live?.warmModelId ? ` Ready to keep ${live.warmModelId} warm.` : ' No installed model fits this computer yet.'}
          </p>
        </div>
        <button type="button" className="toggle mt-1" data-keep-warm="yes" data-on={settings.keepWarm ? 'yes' : 'no'} aria-pressed={settings.keepWarm} onClick={() => onPatch({ keepWarm: !settings.keepWarm })}><span /></button>
      </div>
      <label className="mt-3 block text-sm">
        <span className="font-semibold">Unload after quiet minutes</span>
        <input
          className="field mt-2"
          data-idle-minutes="yes"
          inputMode="numeric"
          aria-label="Minutes before the model unloads"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          onBlur={() => {
            const value = Math.min(240, Math.max(1, Math.round(Number(minutes))))
            if (!Number.isFinite(value)) {
              setMinutes(String(settings.idleUnloadMinutes))
              return
            }
            setMinutes(String(value))
            if (value !== settings.idleUnloadMinutes) onPatch({ idleUnloadMinutes: value })
          }}
        />
      </label>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Speculative decoding</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]" data-speculative-reason="yes">{reason}</p>
        </div>
        <button type="button" className="toggle mt-1" data-speculative="yes" data-on={settings.speculativeDecoding ? 'yes' : 'no'} aria-pressed={settings.speculativeDecoding} onClick={() => onPatch({ speculativeDecoding: !settings.speculativeDecoding })}><span /></button>
      </div>
      {live && !live.draftInstalled && live.speculative === 'offer' && (
        <button type="button" className="btn btn-ghost mt-3" data-draft-download="yes" onClick={() => onDownload(live.draftModelId)}>
          Download Qwen 0.6B draft
        </button>
      )}
    </div>
  )
}

export function UsagePanel() {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void window.surf.usage.get().then(setReport).catch((err: unknown) => setError((err as Error).message))
  }, [])
  return (
    <div className="card px-4 py-4" data-usage-page="yes">
      <div className="text-sm font-semibold">On this computer</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
        Tasks, steps, and token timings stay in the app data folder. Nothing here is sent off this device.
      </p>
      {error && <p className="mt-2 text-sm">{error}</p>}
      {report ? <UsageFigures report={report} /> : <p className="mt-2 text-sm text-[var(--muted)]">Checking usage…</p>}
      {confirming ? (
        <div className="mt-3 flex gap-2" data-usage-reset-confirm="yes">
          <button type="button" className="btn btn-primary" data-usage-reset-yes="yes" onClick={() => {
            setConfirming(false)
            void window.surf.usage.reset().then(setReport).catch((err: unknown) => setError((err as Error).message))
          }}>Reset usage</button>
          <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost mt-3" data-usage-reset="yes" onClick={() => setConfirming(true)}>Reset</button>
      )}
    </div>
  )
}

export function StoragePanel() {
  const [report, setReport] = useState<StorageReport | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<{ category: StorageCategoryId; itemId?: string; label: string } | null>(null)
  function reload() {
    void window.surf.storage.report().then(setReport).catch((err: unknown) => setError((err as Error).message))
  }
  useEffect(() => { reload() }, [])
  return (
    <div className="card px-4 py-4" data-storage-page="yes">
      <div className="text-sm font-semibold">On this computer</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
        Delete only removes files inside the app data folder. A confirmation is required for each clear.
      </p>
      {report && (
        <p className="mt-2 text-sm" data-storage-total="yes">
          App data {formatIndexBytes(report.totalBytes)} · free {formatIndexBytes(report.freeBytes)} of {formatIndexBytes(report.diskBytes)}
        </p>
      )}
      {error && <p className="mt-2 text-sm">{error}</p>}
      {report?.categories.map((category) => (
        <div key={category.id} className="mt-4" data-storage-category={category.id}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">{category.label}</div>
            <span className="text-sm text-[var(--muted)]">{formatIndexBytes(category.bytes)}</span>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {category.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {item.label}
                  {item.version ? ` · v${item.version}` : ''}
                  <span className="text-[var(--muted)]"> · {formatIndexBytes(item.bytes)}</span>
                </span>
                <button type="button" className="btn btn-ghost" data-storage-clear={category.id} onClick={() => setPending({ category: category.id, itemId: item.id, label: item.label })}>Clear</button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-ghost" data-storage-clear-all={category.id} onClick={() => setPending({ category: category.id, label: category.label })}>Clear all</button>
            <button type="button" className="btn btn-ghost" data-storage-open={category.id} onClick={() => { void window.surf.storage.open(category.id).catch((err: unknown) => setError((err as Error).message)) }}>Open folder</button>
          </div>
        </div>
      ))}
      {pending && (
        <div className="mt-4" data-storage-confirm="yes">
          <p className="text-sm">Delete {pending.label} from this computer?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary" data-storage-confirm-yes="yes" onClick={() => {
              const target = pending
              setPending(null)
              void window.surf.storage.clear({ category: target.category, itemId: target.itemId }).then(setReport).catch((err: unknown) => setError((err as Error).message))
            }}>Delete</button>
            <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

function UsageFigures({ report }: { report: UsageReport }) {
  const speed = report.tokensPerSec == null ? '—' : `${report.tokensPerSec} tok/s`
  return (
    <div className="mt-3 text-sm" data-usage-figures="yes">
      <p>{report.tasks} tasks · {report.steps} steps · {report.tokensIn} tokens in · {report.tokensOut} tokens out</p>
      <p className="mt-1">{speed} · first token p50 {ms(report.ttftP50Ms)} · p95 {ms(report.ttftP95Ms)}</p>
      <p className="mt-1">Model RAM {report.ramMb == null ? '—' : `${report.ramMb} MB`} · CPU {report.cpuPercent == null ? '—' : `${report.cpuPercent}%`}</p>
      {report.models.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1" data-usage-models="yes">
          {report.models.map((model) => (
            <li key={model.modelId}>
              {model.modelId}: {model.tasks} tasks, {model.steps} steps, {model.tokensIn}/{model.tokensOut} tokens, {model.tokensPerSec ?? '—'} tok/s
            </li>
          ))}
        </ul>
      )}
      {report.days.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1" data-usage-days="yes">
          {report.days.map((day) => (
            <li key={day.day}>{day.day}: {day.tasks} tasks, {day.tokensOut} tokens out</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ms(value: number | null): string {
  return value == null ? '—' : `${Math.round(value)} ms`
}
