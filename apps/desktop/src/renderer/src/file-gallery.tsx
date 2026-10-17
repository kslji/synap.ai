/**
 * Static scenes for light and dark screenshots. Not part of the app window.
 */
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { FileAnswerCard, FilePermissionCard, FilePermissionsPage, IndexingProgress } from './screens/FilePermissions'
import { FILE_INDEX_TIME_NOTE, type FileFolderGrant, type FileIndexLimits, type FileIndexProgress, type FileSuggestFolder } from '../../shared/ipc-contract'

const prompt = {
  id: 'm1',
  messageId: 'm1',
  label: '~/Projects',
  path: '/Users/me/Projects',
  question: 'Allow Synap.surf to search ~/Projects?',
  specific: true,
  note: null,
}

const homePrompt = {
  id: 'm2',
  messageId: 'm2',
  label: 'Whole home folder',
  path: '/Users/me',
  question: 'Allow Synap.surf to search the whole home folder?',
  specific: true,
  note: FILE_INDEX_TIME_NOTE,
}

const progress: FileIndexProgress = {
  grantId: 'downloads',
  path: '/Users/me/Downloads',
  done: 12,
  total: 40,
  byteSize: 1_280_000,
  status: 'indexing',
  error: null,
}

const suggestions: FileSuggestFolder[] = [
  { id: 'projects', kind: 'common', label: '~/Projects', path: '/Users/me/Projects', fileCount: 1840, byteSize: 920_000_000, needsPermission: false, note: null, granted: false },
  { id: 'onedrive', kind: 'common', label: '~/OneDrive', path: '/Users/me/OneDrive', fileCount: 640, byteSize: 210_000_000, needsPermission: false, note: null, granted: false },
  { id: 'pictures', kind: 'common', label: '~/Pictures', path: '/Users/me/Pictures', fileCount: 420, byteSize: 3_200_000_000, needsPermission: false, note: null, granted: false },
  { id: 'work', kind: 'common', label: '~/Work', path: '/Users/me/Work', fileCount: 86, byteSize: 44_000_000, needsPermission: false, note: null, granted: true },
  { id: 'documents', kind: 'protected', label: '~/Documents', path: '/Users/me/Documents', fileCount: null, byteSize: null, needsPermission: true, note: null, granted: false },
  { id: 'desktop', kind: 'protected', label: '~/Desktop', path: '/Users/me/Desktop', fileCount: null, byteSize: null, needsPermission: true, note: null, granted: false },
  { id: 'downloads', kind: 'protected', label: '~/Downloads', path: '/Users/me/Downloads', fileCount: null, byteSize: null, needsPermission: true, note: null, granted: false },
  { id: 'drive-d', kind: 'drive', label: 'D:', path: 'D:/', fileCount: 1200, byteSize: 80_000_000_000, needsPermission: false, note: FILE_INDEX_TIME_NOTE, granted: false },
  { id: 'home', kind: 'home', label: 'Whole home folder', path: '/Users/me', fileCount: null, byteSize: null, needsPermission: false, note: FILE_INDEX_TIME_NOTE, granted: false },
]

const limits: FileIndexLimits = {
  maxFiles: 20000,
  extensions: ['pdf', 'docx', 'txt', 'md', 'png'],
  filesPerSec: 42,
}

const grants: FileFolderGrant[] = [
  {
    id: 'documents',
    path: '/Users/me/Documents',
    label: '~/Documents',
    scope: 'always',
    grantedAt: Date.parse('2026-10-17T09:00:00Z'),
    lastIndexedAt: Date.parse('2026-10-17T14:12:00Z'),
    fileCount: 86,
    indexedCount: 86,
    byteSize: 4_400_000,
    status: 'ready',
    error: null,
    embedder: 'gemma',
    settingsUrl: null,
    settingsLabel: null,
  },
  {
    id: 'downloads',
    path: '/Users/me/Downloads',
    label: '~/Downloads',
    scope: 'always',
    grantedAt: Date.parse('2026-10-17T14:10:00Z'),
    lastIndexedAt: null,
    fileCount: 40,
    indexedCount: 12,
    byteSize: 1_280_000,
    status: 'indexing',
    error: null,
    embedder: 'hash',
    settingsUrl: null,
    settingsLabel: null,
  },
]

function scene(): string {
  return new URLSearchParams(window.location.search).get('scene') || 'card'
}

function Frame({ children }: { children: ReactNode }) {
  return <div style={{ width: 880, padding: 28, background: 'var(--bg)', color: 'var(--ink)', minHeight: 520 }}>{children}</div>
}

function Gallery() {
  const which = scene()
  if (which === 'card') {
    return (
      <Frame>
        <div className="file-answer">
          <FileAnswerCard text="" citations={[]} searching onOpen={() => undefined} />
        </div>
        <FilePermissionCard prompt={prompt} onOnce={() => undefined} onAlways={() => undefined} onDeny={() => undefined} onAdd={() => undefined} />
      </Frame>
    )
  }
  if (which === 'progress') {
    return (
      <Frame>
        <div className="card px-4 py-4" style={{ maxWidth: 640 }}>
          <div className="text-sm font-semibold">Indexing ~/Downloads</div>
          <p className="mt-1 text-sm text-[var(--muted)]">Synap.surf is reading files you allowed. Your files are not changed.</p>
          <IndexingProgress progress={progress} />
        </div>
      </Frame>
    )
  }
  if (which === 'permissions') {
    return (
      <Frame>
        <h1 className="page-title" style={{ marginTop: 0 }}>Settings</h1>
        <p className="page-sub">Permissions stay on this computer.</p>
        <div style={{ marginTop: 16, maxWidth: 720 }}>
          <FilePermissionsPage
            grants={grants}
            suggestions={suggestions}
            progress={progress}
            limits={limits}
            onChoose={() => undefined}
            onAdd={() => undefined}
            onRevoke={() => undefined}
            onOpenSettings={() => undefined}
            onPause={() => undefined}
            onResume={() => undefined}
            onSaveLimits={() => undefined}
          />
        </div>
      </Frame>
    )
  }
  if (which === 'home') {
    return (
      <Frame>
        <div className="file-answer">
          <FileAnswerCard text="" citations={[]} searching onOpen={() => undefined} />
        </div>
        <FilePermissionCard prompt={homePrompt} onOnce={() => undefined} onAlways={() => undefined} onDeny={() => undefined} onAdd={() => undefined} />
      </Frame>
    )
  }
  return (
    <Frame>
      <FileAnswerCard
        searching={false}
        onOpen={() => undefined}
        text={'The Razorpay key setup uses `key_id` from the dashboard. [S1]'}
        citations={[
          { title: '~/Downloads/razorpay-setup.md', fileName: 'razorpay-setup.md', filePath: '/Users/me/Downloads/razorpay-setup.md' },
        ]}
      />
    </Frame>
  )
}

const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.dataset.theme = theme
createRoot(document.getElementById('root')!).render(<Gallery />)
