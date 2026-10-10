import { StarSurf } from '@surf/ui'
import type { ExportFormat, FillPlan, FillRow } from '../../../shared/ipc-contract'

const NOT_FOUND = 'not found in source'

export const CONVERT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'docx', label: 'Word' },
  { id: 'pdf', label: 'PDF' },
  { id: 'txt', label: 'Text' },
  { id: 'md', label: 'Markdown' },
  { id: 'html', label: 'HTML' },
  { id: 'png', label: 'PNG' },
  { id: 'jpeg', label: 'JPEG' },
  { id: 'csv', label: 'CSV' },
  { id: 'xlsx', label: 'Excel' },
]

export interface ConvertPanelState {
  name: string
  format: ExportFormat
  progress: number
  stage: string
  warnings: string[]
  output: string | null
  error: string | null
  busy: boolean
}

export function ConvertDialog({
  state,
  onFormat,
  onRun,
  onCancel,
  onClose,
}: {
  state: ConvertPanelState
  onFormat: (format: ExportFormat) => void
  onRun: () => void
  onCancel: () => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4" data-convert="yes">
      <div className="card w-full max-w-lg px-5 py-5">
        <div className="flex items-start gap-3">
          <StarSurf state="searching" size={72} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Convert a copy</h2>
            <p className="mt-1 truncate text-sm text-[var(--muted)]">{state.name}</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        <p className="mt-4 text-sm text-[var(--muted)]">
          The original stays as it is. A new file is saved next to it, or in a folder you choose. Layout that cannot be kept is listed below.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {CONVERT_FORMATS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === state.format ? 'btn btn-primary' : 'btn btn-ghost'}
              data-format={item.id}
              onClick={() => onFormat(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {(state.busy || state.progress > 0) && (
          <div className="mt-4">
            <div className="progress" aria-hidden="true"><b style={{ width: `${Math.round(state.progress * 100)}%` }} /></div>
            <p className="mt-2 text-xs text-[var(--muted)]">{state.stage}</p>
          </div>
        )}
        {state.warnings.map((warning) => (
          <p key={warning} className="mt-3 text-sm text-[var(--warn)]" data-warning="yes">{warning}</p>
        ))}
        {state.output && <p className="mt-3 text-sm" data-output="yes">Saved {state.output}</p>}
        {state.error && <p className="mt-3 text-sm text-[var(--danger)]">{state.error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          {state.busy ? (
            <button type="button" className="btn btn-ghost" data-cancel-convert="yes" onClick={onCancel}>Cancel</button>
          ) : (
            <button type="button" className="btn btn-primary" data-run-convert="yes" onClick={onRun}>Save copy</button>
          )}
        </div>
      </div>
    </div>
  )
}

export interface FillPanelState {
  templateName: string
  sourceName: string | null
  plan: FillPlan | null
  highlight: boolean
  format: ExportFormat | 'same'
  progress: number
  stage: string
  output: string | null
  error: string | null
  busy: boolean
  accepted: Record<string, boolean>
}

export function FillReview({
  state,
  onPickSource,
  onSwap,
  onEdit,
  onAccept,
  onHighlight,
  onFormat,
  onExport,
  onCancel,
  onClose,
}: {
  state: FillPanelState
  onPickSource: () => void
  onSwap: () => void
  onEdit: (id: string, value: string) => void
  onAccept: (id: string) => void
  onHighlight: (on: boolean) => void
  onFormat: (format: ExportFormat | 'same') => void
  onExport: () => void
  onCancel: () => void
  onClose: () => void
}) {
  const rows = state.plan?.rows ?? []
  const unfilled = rows.filter((row) => !row.found || row.value === NOT_FOUND)
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 px-4 py-6" data-fill="yes">
      <div className="card flex max-h-full w-full max-w-3xl flex-col px-5 py-5">
        <div className="flex items-start gap-3">
          <StarSurf state="searching" size={72} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">Fill from another document</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Form: {state.templateName}. Source: {state.sourceName ?? 'not chosen'}. Values come only from the source.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
        {state.plan?.role === 'ask' && (
          <div className="mt-4 rounded-2xl border border-[var(--line)] px-4 py-3 text-sm" data-ask="yes">
            <p>Both files look like forms, or neither has a blank. Which file should be filled?</p>
            <button type="button" className="btn btn-ghost mt-3" onClick={onSwap}>Use the other file as the form</button>
          </div>
        )}
        {state.plan?.warnings.map((warning) => (
          <p key={warning} className="mt-3 text-sm text-[var(--warn)]" data-warning="yes">{warning}</p>
        ))}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={onPickSource}>Choose source</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={state.highlight} onChange={(event) => onHighlight(event.target.checked)} />
            Highlight filled values
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-[var(--muted)]">Export</span>
            <select className="field !w-auto !py-2" value={state.format} onChange={(event) => onFormat(event.target.value as ExportFormat | 'same')}>
              <option value="same">Same format</option>
              {CONVERT_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          <table className="w-full text-left text-sm" data-fill-rows="yes">
            <thead className="text-xs text-[var(--muted)]">
              <tr>
                <th className="py-2 pr-3 font-medium">Blank</th>
                <th className="py-2 pr-3 font-medium">Value</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <FillLine key={row.id} row={row} accepted={Boolean(state.accepted[row.id])} onEdit={onEdit} onAccept={onAccept} />
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-sm text-[var(--muted)]">No blanks yet. Choose the source document.</p>}
        </div>
        {unfilled.length > 0 && (
          <div className="mt-3 text-sm" data-unfilled="yes">
            <p className="font-medium">Not filled</p>
            <ul className="mt-1 text-[var(--muted)]">
              {unfilled.map((row) => <li key={row.id}>{row.label}: {NOT_FOUND}</li>)}
            </ul>
          </div>
        )}
        {(state.busy || state.progress > 0) && (
          <div className="mt-3">
            <div className="progress" aria-hidden="true"><b style={{ width: `${Math.round(state.progress * 100)}%` }} /></div>
            <p className="mt-1 text-xs text-[var(--muted)]">{state.stage}</p>
          </div>
        )}
        {state.output && <p className="mt-3 text-sm" data-output="yes">Saved {state.output}</p>}
        {state.error && <p className="mt-3 text-sm text-[var(--danger)]">{state.error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {state.busy ? (
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          ) : (
            <button type="button" className="btn btn-primary" data-export-fill="yes" disabled={!state.plan} onClick={onExport}>Save filled copy</button>
          )}
        </div>
      </div>
    </div>
  )
}

function FillLine({
  row,
  accepted,
  onEdit,
  onAccept,
}: {
  row: FillRow
  accepted: boolean
  onEdit: (id: string, value: string) => void
  onAccept: (id: string) => void
}) {
  return (
    <tr className="border-t border-[var(--line)]" data-blank={row.label}>
      <td className="py-2 pr-3 align-top font-medium">{row.label}</td>
      <td className="py-2 pr-3 align-top">
        <input className="field !py-2" value={row.value} onChange={(event) => onEdit(row.id, event.target.value)} />
      </td>
      <td className="py-2 pr-3 align-top text-[var(--muted)]">{row.citation ?? (row.found ? '' : 'none')}</td>
      <td className="py-2 align-top">
        <button type="button" className={accepted ? 'btn btn-primary' : 'btn btn-ghost'} data-accept={row.id} onClick={() => onAccept(row.id)}>
          {accepted ? 'Accepted' : 'Accept'}
        </button>
      </td>
    </tr>
  )
}
