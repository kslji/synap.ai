/**
 * Permission card, indexing progress, and the Settings → Permissions list.
 * Granting always goes through the OS folder picker. Nothing is allowed automatically.
 */
import { useEffect, useState } from 'react'
import { BlobMascot } from '@surf/ui'
import type { FileFolderGrant, FileIndexProgress, FilePermissionPrompt, FileSuggestFolder } from '../../../shared/ipc-contract'
import { formatIndexBytes } from '../format'

export function formatIndexedAt(ms: number | null): string {
  if (!ms) return 'Not indexed yet'
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

export function FilePermissionCard({
  prompt,
  onOnce,
  onAlways,
  onDeny,
}: {
  prompt: FilePermissionPrompt
  onOnce: () => void
  onAlways: () => void
  onDeny: () => void
}) {
  return (
    <div className="card file-permit" data-file-permission="yes">
      <h3>{prompt.question}</h3>
      <p>Synap.surf only reads this folder after you pick it. Files stay on this computer. Allow once lasts until you quit. Always keeps the folder until you revoke it.</p>
      <div className="file-permit-actions">
        <button className="btn btn-primary" type="button" data-file-allow="once" onClick={onOnce}>Allow once</button>
        <button className="btn btn-ghost" type="button" data-file-allow="always" onClick={onAlways}>Always for this folder</button>
        <button className="btn btn-ghost" type="button" data-file-allow="deny" onClick={onDeny}>Don't allow</button>
      </div>
    </div>
  )
}

export function IndexingProgress({ progress }: { progress: FileIndexProgress }) {
  const total = Math.max(progress.total, progress.done, 1)
  const width = Math.max(0, Math.min(100, Math.round((progress.done / total) * 100)))
  return (
    <div className="file-progress" data-file-progress="yes">
      <div className="file-progress-meta">
        <span>Indexing {progress.done} of {progress.total} files</span>
        <span>{formatIndexBytes(progress.byteSize)}</span>
      </div>
      <div className="file-progress-bar" aria-hidden="true"><span style={{ width: `${width}%` }} /></div>
    </div>
  )
}

export function FilePermissionsPage({
  grants,
  suggestions,
  progress,
  onChoose,
  onRevoke,
  onOpenSettings,
}: {
  grants: FileFolderGrant[]
  suggestions: FileSuggestFolder[]
  progress: FileIndexProgress | null
  onChoose: (path: string) => void
  onRevoke: (id: string) => void
  onOpenSettings: (urlKind: FileFolderGrant) => void
}) {
  return (
    <div data-file-permissions="yes">
      <div className="card px-4 py-4">
        <div className="text-sm font-semibold">Folders Synap.surf can search</div>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
          Nothing outside the open project or your Library is read until you grant a folder. Suggestions are not access. Revoke deletes the index for that folder. Your files stay where they are.
        </p>
        <div className="mt-3">
          {suggestions.map((item) => (
            <div key={item.id} className="file-suggest" data-file-suggest={item.id}>
              <div>
                <div className="text-sm font-semibold">{item.label}</div>
                <div className="text-xs text-[var(--muted)]">{item.granted ? 'Allowed' : 'Not allowed'}</div>
              </div>
              <button className="btn btn-ghost" type="button" data-file-choose={item.id} onClick={() => onChoose(item.path)}>
                {item.granted ? 'Choose again' : 'Choose folder'}
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="card mt-4 px-4 py-4">
        <div className="text-sm font-semibold">Granted folders</div>
        {grants.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">No folders yet.</p>}
        {grants.map((grant) => (
          <div key={grant.id} className="file-grant" data-file-grant={grant.id}>
            <div>
              <h3>{grant.label}</h3>
              <p>
                {grant.indexedCount} files indexed · {formatIndexBytes(grant.byteSize)} · {formatIndexedAt(grant.lastIndexedAt)}
                {grant.scope === 'once' ? ' · this session' : ''}
              </p>
              {progress && progress.grantId === grant.id && progress.status === 'indexing' && <IndexingProgress progress={progress} />}
              {grant.error && <p className="file-denial" data-file-denial="yes">{grant.error}</p>}
              {grant.settingsUrl && grant.settingsLabel && (
                <button className="btn btn-ghost mt-2" type="button" data-file-settings="yes" onClick={() => onOpenSettings(grant)}>{grant.settingsLabel}</button>
              )}
            </div>
            <button className="btn btn-ghost" type="button" data-file-revoke={grant.id} onClick={() => onRevoke(grant.id)}>Revoke</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export function FileAnswerCard({
  text,
  citations,
  searching,
  onOpen,
}: {
  text: string
  citations: { title: string; filePath?: string }[]
  searching: boolean
  onOpen: (path: string) => void
}) {
  return (
    <div className="file-answer" data-file-answer="yes">
      <BlobMascot variant="avatar" state={searching ? 'searching' : 'idle'} size={44} animate={false} />
      <div className="assistant-card">
        {searching && <div className="mb-1 text-sm text-[var(--muted)]" data-file-searching="yes">Searching your files…</div>}
        <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</div>
        <div>
          {citations.map((source, index) => (
            <button
              key={source.filePath || source.title}
              type="button"
              className="pill file-cite"
              data-citation="yes"
              data-file-citation="yes"
              onClick={() => { if (source.filePath) onOpen(source.filePath) }}
            >
              [S{index + 1}] {source.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function FilePermissionsPanel() {
  const [grants, setGrants] = useState<FileFolderGrant[]>([])
  const [suggestions, setSuggestions] = useState<FileSuggestFolder[]>([])
  const [progress, setProgress] = useState<FileIndexProgress | null>(null)
  const [note, setNote] = useState('')

  async function reload() {
    const [listed, suggested] = await Promise.all([window.surf.files.list(), window.surf.files.suggestions()])
    setGrants(listed)
    setSuggestions(suggested)
  }

  useEffect(() => {
    void reload().catch((error: unknown) => setNote((error as Error).message))
    return window.surf.files.onEvent((event) => {
      if (event.type === 'progress') {
        setProgress(event.progress)
        if (event.progress.status !== 'indexing') void reload().catch(() => undefined)
      }
    })
  }, [])

  return (
    <>
      <FilePermissionsPage
        grants={grants}
        suggestions={suggestions}
        progress={progress}
        onChoose={(path) => {
          void window.surf.files.pick(path).then(async (picked) => {
            if (!picked) return
            await window.surf.files.grant({ path: picked, scope: 'always' })
            await reload()
          }).catch((error: unknown) => setNote((error as Error).message))
        }}
        onRevoke={(id) => {
          void window.surf.files.revoke(id).then(reload).catch((error: unknown) => setNote((error as Error).message))
        }}
        onOpenSettings={(grant) => {
          const kind = grant.error?.includes('Full Disk')
            ? 'macos-full-disk'
            : grant.error?.includes('Controlled folder')
              ? 'windows-controlled-folder'
              : grant.error?.includes('Windows denied')
                ? 'windows-acl'
                : 'macos-files-and-folders'
          void window.surf.files.openSettings(kind)
        }}
      />
      {note && <p className="text-sm text-[var(--muted)]">{note}</p>}
    </>
  )
}
