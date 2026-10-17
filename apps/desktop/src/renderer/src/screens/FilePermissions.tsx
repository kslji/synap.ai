/**
 * Permission card, indexing progress, and the Settings → Permissions list.
 * Granting always goes through the OS folder picker. Nothing is allowed automatically.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { BlobMascot, parseMarkdown, type Inline } from '@surf/ui'
import { citedFileSources } from '../../../shared/cited-sources'
import type { FileFolderGrant, FileIndexProgress, FilePermissionPrompt, FileSuggestFolder } from '../../../shared/ipc-contract'
import { formatIndexBytes } from '../format'

export function embedderLabel(kind: 'gemma' | 'hash'): string {
  return kind === 'gemma' ? 'EmbeddingGemma' : 'Temporary keyword embeddings'
}

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
  const label = progress.phase === 'embed'
    ? `Updating embeddings ${progress.done} of ${progress.total} files`
    : `Indexing ${progress.done} of ${progress.total} files`
  return (
    <div className="file-progress" data-file-progress="yes" data-file-phase={progress.phase ?? 'index'}>
      <div className="file-progress-meta">
        <span>{label}</span>
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
                {' · '}<span data-file-embedder={grant.embedder}>{embedderLabel(grant.embedder)}</span>
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

export interface FileAnswerSource {
  title: string
  fileName?: string
  filePath?: string
  locator?: string | null
}

export function FileAnswerBody({
  text,
  sources,
  onOpen,
}: {
  text: string
  sources: FileAnswerSource[]
  onOpen: (path: string) => void
}) {
  const cited = citedFileSources(text, sources)
  return (
    <>
      <div className="file-answer-body text-[15px] leading-relaxed" data-file-answer-body="yes">
        <AnswerMarkdown source={text} onCite={(n) => { const path = sources[n - 1]?.filePath; if (path) onOpen(path) }} />
      </div>
      {cited.length > 0 && (
        <div className="file-cite-row">
          {cited.map(({ source, n }) => {
            const name = source.fileName || source.title
            const where = source.fileName && source.title !== source.fileName ? source.title : ''
            const place = [where, source.locator].filter(Boolean).join(' · ')
            return (
              <button
                key={`${n}-${source.filePath}`}
                type="button"
                className="pill file-cite"
                data-citation="yes"
                data-file-citation="yes"
                onClick={() => { if (source.filePath) onOpen(source.filePath) }}
              >
                <span className="file-cite-mark">S{n}</span>
                <span className="file-cite-name">{name}</span>
                {place && <span className="file-cite-path">{place}</span>}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}

export function FileAnswerCard({
  text,
  citations,
  searching,
  onOpen,
}: {
  text: string
  citations: FileAnswerSource[]
  searching: boolean
  onOpen: (path: string) => void
}) {
  return (
    <div className="file-answer" data-file-answer="yes">
      <BlobMascot variant="avatar" state={searching ? 'searching' : 'idle'} size={44} animate={false} />
      <div className="assistant-card">
        {searching && <div className="mb-1 text-sm text-[var(--muted)]" data-file-searching="yes">Searching your files…</div>}
        <FileAnswerBody text={text} sources={citations} onOpen={onOpen} />
      </div>
    </div>
  )
}

function AnswerMarkdown({ source, onCite }: { source: string; onCite: (n: number) => void }) {
  const blocks = parseMarkdown(source)
  return blocks.map((block, index) => {
    if (block.type === 'heading') {
      const tag = block.level <= 2 ? 'h3' : 'h4'
      return <Heading key={index} tag={tag} nodes={block.children} onCite={onCite} />
    }
    if (block.type === 'paragraph') return <p key={index}><InlineBits nodes={block.children} onCite={onCite} /></p>
    if (block.type === 'list') {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag key={index} className={block.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
          {block.items.map((item, itemIndex) => <li key={itemIndex}><InlineBits nodes={item} onCite={onCite} /></li>)}
        </Tag>
      )
    }
    return <p key={index}><InlineBits nodes={block.type === 'table' ? block.header.flat() : []} onCite={onCite} /></p>
  })
}

function Heading({ tag, nodes, onCite }: { tag: 'h3' | 'h4'; nodes: Inline[]; onCite: (n: number) => void }) {
  const content = <InlineBits nodes={nodes} onCite={onCite} />
  return tag === 'h3' ? <h3 className="text-base font-semibold">{content}</h3> : <h4 className="text-base font-semibold">{content}</h4>
}

function InlineBits({ nodes, onCite }: { nodes: Inline[]; onCite: (n: number) => void }): ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <CiteSpans key={index} text={node.text} onCite={onCite} />
    if (node.type === 'strong') return <strong key={index}><InlineBits nodes={node.children} onCite={onCite} /></strong>
    if (node.type === 'em') return <em key={index}><InlineBits nodes={node.children} onCite={onCite} /></em>
    if (node.type === 'code') return <code key={index}>{node.text}</code>
    return <InlineBits key={index} nodes={node.children} onCite={onCite} />
  })
}

function CiteSpans({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const parts = text.split(/(\[S\d+\])/g)
  return parts.map((part, index) => {
    const mark = /^\[S(\d+)\]$/.exec(part)
    if (!mark) return <span key={index}>{part}</span>
    const n = Number(mark[1])
    return (
      <button key={index} type="button" className="file-cite-inline" data-file-marker={n} onClick={() => onCite(n)}>
        {part}
      </button>
    )
  })
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
