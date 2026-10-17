import { useEffect, useState, type ReactNode } from 'react'
import { Boxes, Cpu, HardDrive, Hash } from 'lucide-react'
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

const RANGES = ['1d', '7d', '30d', 'mtd', 'last'] as const
type UsageRange = (typeof RANGES)[number]
const RANGE_LABEL: Record<UsageRange, string> = { '1d': '1d', '7d': '7d', '30d': '30d', mtd: 'MTD', last: 'Last month' }

export function UsagePanel({ machine }: { machine?: { cpuModel: string; ramGb: number } }) {
  const [report, setReport] = useState<UsageReport | null>(null)
  const [range, setRange] = useState<UsageRange>('30d')
  const [filter, setFilter] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void window.surf.usage.get().then(setReport).catch((err: unknown) => setError((err as Error).message))
  }, [])
  const rows = report ? rowsInRange(report, range, filter, new Date()) : []
  const tokens = rows.reduce((sum, row) => sum + row.tokensIn + row.tokensOut, 0)
  const requests = rows.reduce((sum, row) => sum + row.tasks, 0)
  const modelIds = [...new Set(rows.map((row) => row.modelId).filter(Boolean))]
  return (
    <section className="usage-page flex-1 overflow-auto px-8 py-8" data-usage-view="yes" data-usage-page="yes">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="page-title">Usage</h1>
            <p className="page-sub">
              Requests, tokens, model, agent, and day from the log on this computer.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {machine && machine.cpuModel.trim() && machine.cpuModel.trim().toLowerCase() !== 'unknown' && (
              <span className="pill" data-usage-hardware="yes">{machine.cpuModel.trim()} · {machine.ramGb} GB RAM</span>
            )}
            <button type="button" className="btn btn-primary" data-usage-csv="yes" onClick={() => {
              void window.surf.usage.csv().then((csv) => downloadCsv(csv)).catch((err: unknown) => setError((err as Error).message))
            }}>Export CSV</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Usage range">
          {RANGES.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={range === id} data-usage-range={id} className="chip-tab" onClick={() => setRange(id)}>
              {RANGE_LABEL[id]}
            </button>
          ))}
        </div>
        {error && <p className="text-sm">{error}</p>}
        {!report && <p className="text-sm text-[var(--muted)]">Checking usage…</p>}
        {report && (
          <>
            <div className="grid gap-3 md:grid-cols-3" data-usage-figures="yes">
              <Stat label="Requests" value={String(requests)} tile="orange" icon={<Hash size={16} />} />
              <Stat label="Tokens" value={formatCount(tokens)} tile="violet" icon={<Boxes size={16} />} />
              <Stat label="Models" value={String(modelIds.length)} tile="blue" icon={<Cpu size={16} />} />
            </div>
            <UsageChart rows={rows} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold tracking-tight">Local inference history</h2>
              <input className="field w-auto" data-usage-filter="yes" aria-label="Filter by agent or model" placeholder="Filter by agent or model" value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
            <div className="card overflow-hidden">
              <table className="usage-table w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Agent</th>
                    <th>Model</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-sm text-[var(--muted)]" data-usage-empty="yes">No requests in this range.</td>
                    </tr>
                  ) : rows.map((row) => (
                    <tr key={`${row.day}-${row.agentId}-${row.modelId}`} data-usage-days="yes">
                      <td>{row.day}</td>
                      <td data-usage-agents="yes">{row.agentId || 'unspecified'}</td>
                      <td data-usage-models="yes">{row.modelId}</td>
                      <td>{formatCount(row.tokensIn + row.tokensOut)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {confirming ? (
              <div className="flex gap-2" data-usage-reset-confirm="yes">
                <button type="button" className="btn btn-primary" data-usage-reset-yes="yes" onClick={() => {
                  setConfirming(false)
                  void window.surf.usage.reset().then(setReport).catch((err: unknown) => setError((err as Error).message))
                }}>Reset usage</button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost self-start" data-usage-reset="yes" onClick={() => setConfirming(true)}>Reset</button>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value, icon, tile }: { label: string; value: string; icon: ReactNode; tile: 'orange' | 'violet' | 'blue' }) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between gap-3">
        <div className="stat-kicker">{label}</div>
        <span className={`icon-tile ${tile === 'violet' ? 'is-violet' : tile === 'blue' ? 'is-blue' : ''}`}>{icon}</span>
      </div>
      <div className="stat-value">{value}</div>
    </div>
  )
}

function UsageChart({ rows }: { rows: UsageReport['entries'] }) {
  const days = [...new Set(rows.map((row) => row.day))].sort()
  const models = [...new Set(rows.map((row) => row.modelId).filter(Boolean))]
  const max = Math.max(1, ...days.map((day) => rows.filter((row) => row.day === day).reduce((sum, row) => sum + row.tokensIn + row.tokensOut, 0)))
  return (
    <div className="card chart-frame px-5 py-5" data-usage-chart="yes">
      <div className="text-sm font-semibold">Tokens by model</div>
      <p className="mt-1 text-sm text-[var(--muted)]">Each bar is one day from the log on this computer.</p>
      {days.length === 0 ? (
        <div className="chart-empty mt-4">No requests in this range.</div>
      ) : (
      <div className="mt-4 flex h-40 items-end gap-3">
        {days.map((day) => {
          const slice = rows.filter((row) => row.day === day)
          const total = slice.reduce((sum, row) => sum + row.tokensIn + row.tokensOut, 0)
          return (
            <div key={day} className="flex h-full min-w-8 flex-1 flex-col justify-end" title={`${day}: ${formatCount(total)} tokens`}>
              <div className="flex flex-col justify-end overflow-hidden rounded-md" style={{ height: `${Math.max(4, (total / max) * 100)}%` }}>
                {models.map((model, index) => {
                  const part = slice.find((row) => row.modelId === model)
                  const tokens = part ? part.tokensIn + part.tokensOut : 0
                  if (!tokens || !total) return null
                  return <div key={model} style={{ height: `${(tokens / total) * 100}%`, background: CHART[index % CHART.length] }} />
                })}
              </div>
              <div className="mt-1 truncate text-center text-[10px] text-[var(--muted)]">{day.slice(5)}</div>
            </div>
          )
        })}
      </div>
      )}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--muted)]">
        {models.map((model, index) => (
          <span key={model}><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: CHART[index % CHART.length] }} />{model}</span>
        ))}
      </div>
    </div>
  )
}

const CHART = ['#f97316', '#7c3aed', '#2563eb', '#0f766e', '#b45309']

function rowsInRange(report: UsageReport, range: UsageRange, filter: string, now: Date): UsageReport['entries'] {
  const { start, end } = rangeBounds(range, now)
  const needle = filter.trim().toLowerCase()
  return report.entries.filter((row) => {
    if (row.day < start || row.day > end) return false
    if (!needle) return true
    return row.agentId.toLowerCase().includes(needle) || row.modelId.toLowerCase().includes(needle)
  })
}

function rangeBounds(range: UsageRange, now: Date): { start: string; end: string } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const end = isoDay(today)
  if (range === '1d') return { start: end, end }
  if (range === '7d') return { start: isoDay(addUtcDays(today, -6)), end }
  if (range === '30d') return { start: isoDay(addUtcDays(today, -29)), end }
  if (range === 'mtd') return { start: isoDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), end }
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
  return { start: isoDay(start), end: isoDay(last) }
}

function addUtcDays(day: Date, count: number): Date {
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + count))
}

function isoDay(day: Date): string {
  return day.toISOString().slice(0, 10)
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value)
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
    <div className="card px-5 py-5" data-storage-page="yes">
      <div className="flex items-start gap-3">
        <span className="icon-tile is-teal" aria-hidden="true"><HardDrive size={16} /></span>
        <div>
          <div className="text-sm font-semibold">On this computer</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Delete only removes files inside the app data folder. A confirmation is required for each clear.
          </p>
        </div>
      </div>
      {report && (
        <p className="mt-2 text-sm" data-storage-total="yes">
          App data {formatIndexBytes(report.totalBytes)} · free {formatIndexBytes(report.freeBytes)} of {formatIndexBytes(report.diskBytes)}
        </p>
      )}
      {report && <CachePlot report={report} />}
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

function CachePlot({ report }: { report: StorageReport }) {
  const total = report.categories.reduce((sum, category) => sum + category.bytes, 0)
  if (total <= 0) {
    return (
      <div className="mt-3" data-cache-plot="empty">
        <div className="cache-track" />
        <p className="mt-2 text-sm text-[var(--muted)]">Nothing stored in these folders yet.</p>
      </div>
    )
  }
  return (
    <div className="cache-track mt-3 flex" data-cache-plot="yes" aria-label="Storage by category">
      {report.categories.filter((category) => category.bytes > 0).map((category) => (
        <div key={category.id} title={`${category.label} ${formatIndexBytes(category.bytes)}`} style={{ width: `${(category.bytes / total) * 100}%`, background: 'var(--accent)' }} data-cache-slice={category.id} />
      ))}
    </div>
  )
}

function downloadCsv(csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'synap-usage.csv'
  link.click()
  URL.revokeObjectURL(url)
}
