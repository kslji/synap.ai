import { useState } from 'react'
import { StarSurf } from '@surf/ui'
import type { ChunkPreview, LibraryFile } from '../../../shared/ipc-contract'

export function LibraryScreen({
  files,
  preview,
  onAdd,
  onRetry,
  onCancel,
  onRemove,
  onPreview,
  onClosePreview,
  onConvert,
  onFill,
}: {
  files: LibraryFile[]
  preview: ChunkPreview | null
  onAdd: () => void
  onRetry: (jobId: string) => void
  onCancel: (jobId: string) => void
  onRemove: (id: string) => void
  onPreview: (id: string) => void
  onClosePreview: () => void
  onConvert: (file: LibraryFile) => void
  onFill: (file: LibraryFile) => void
}) {
  const [query, setQuery] = useState('')
  const working = files.some((file) => file.status === 'queued' || file.status === 'running')
  const shown = files.filter((file) => file.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex-1 overflow-auto px-8 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Files stay on this computer. Search the ones you added, fill a form, or convert a format.
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button type="button" className="btn btn-ghost" data-convert-file="yes" onClick={() => onConvert({ id: '', name: 'Choose a file', mime: '', sizeBytes: 0, addedAt: 0, conversationIds: [], status: 'done', stage: null, progress: 0, error: null, jobId: null, chunkCount: 0 })}>Convert a file</button>
              <button type="button" className="btn btn-primary" data-add-documents="yes" onClick={onAdd}>Add files</button>
            </div>
          </div>
          <label className="mt-5 block text-sm font-semibold">
            Search my files
            <input className="field mt-2" value={query} aria-label="Search my files" placeholder="Search by name" onChange={(event) => setQuery(event.target.value)} />
          </label>
          {working && (
            <div className="mt-5 flex items-center gap-3" data-processing="yes">
              <StarSurf state="searching" size={72} />
              <p className="text-sm text-[var(--muted)]">Reading your files. You can keep chatting.</p>
            </div>
          )}
          {shown.length === 0 ? (
            <div
              className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-[var(--line)] px-6 py-16 text-center"
              data-upload="yes"
            >
              <StarSurf state="idle" size={96} />
              <p className="mt-3 text-sm text-[var(--muted)]">{query ? 'No files match that search.' : 'Drop PDF, Word, PowerPoint, Excel, text, HTML, or images into a chat, or add them here.'}</p>
            </div>
          ) : (
            <ul className="mt-6 flex flex-col gap-3">
              {shown.map((file) => (
                <li key={file.id} className="card px-4 py-3" data-file-status={file.status}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{file.name}</div>
                      <div className="text-xs text-[var(--muted)]">{statusLine(file)}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" className="btn btn-ghost" data-convert={file.id} onClick={() => onConvert(file)}>Convert</button>
                      <button type="button" className="btn btn-ghost" data-fill={file.id} onClick={() => onFill(file)}>Fill</button>
                      {file.chunkCount > 0 && (
                        <button type="button" className="btn btn-ghost" onClick={() => onPreview(file.id)}>Preview</button>
                      )}
                      {(file.status === 'failed' || file.status === 'cancelled') && file.jobId && (
                        <button type="button" className="btn btn-ghost" onClick={() => onRetry(file.jobId!)}>Retry</button>
                      )}
                      {(file.status === 'queued' || file.status === 'running') && file.jobId && (
                        <button type="button" className="btn btn-ghost" onClick={() => onCancel(file.jobId!)}>Cancel</button>
                      )}
                      <button type="button" className="btn btn-ghost" onClick={() => onRemove(file.id)}>Delete</button>
                    </div>
                  </div>
                  {(file.status === 'queued' || file.status === 'running') && (
                    <div className="progress mt-3" aria-hidden="true"><b style={{ width: `${Math.round(file.progress * 100)}%` }} /></div>
                  )}
                  {file.error && <p className="mt-2 text-xs text-[var(--danger)]">{file.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {preview && <Preview preview={preview} onClose={onClosePreview} />}
    </section>
  )
}

export function Preview({ preview, onClose }: { preview: ChunkPreview; onClose: () => void }) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--bg-side)]" data-preview="yes">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{preview.fileName}</div>
          <div className="text-xs text-[var(--muted)]">{preview.locator ?? preview.heading ?? 'Passage'}</div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
      <div className="flex-1 overflow-auto px-4 py-4 text-sm leading-relaxed whitespace-pre-wrap">{preview.text}</div>
    </aside>
  )
}

function statusLine(file: LibraryFile): string {
  if (file.status === 'running') return file.stage ?? 'Reading'
  if (file.status === 'queued') return 'Waiting'
  if (file.status === 'failed') return 'Could not read this file'
  if (file.status === 'cancelled') return 'Cancelled'
  return file.chunkCount ? `${file.chunkCount} passages` : 'Ready'
}
