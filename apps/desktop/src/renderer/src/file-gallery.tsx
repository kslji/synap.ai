/**
 * Static scenes for light and dark screenshots. Not part of the app window.
 */
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { FileAnswerCard, FilePermissionCard, FilePermissionsPage, IndexingProgress } from './screens/FilePermissions'
import type { FileFolderGrant, FileIndexProgress, FileSuggestFolder } from '../../shared/ipc-contract'

const prompt = {
  id: 'm1',
  messageId: 'm1',
  label: '~/Documents',
  path: '/Users/me/Documents',
  question: 'Allow Synap.surf to search ~/Documents?',
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
  { id: 'documents', label: '~/Documents', path: '/Users/me/Documents', granted: true },
  { id: 'desktop', label: '~/Desktop', path: '/Users/me/Desktop', granted: false },
  { id: 'downloads', label: '~/Downloads', path: '/Users/me/Downloads', granted: true },
]

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
        <FilePermissionCard prompt={prompt} onOnce={() => undefined} onAlways={() => undefined} onDeny={() => undefined} />
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
            onChoose={() => undefined}
            onRevoke={() => undefined}
            onOpenSettings={() => undefined}
          />
        </div>
      </Frame>
    )
  }
  return (
    <Frame>
      <FileAnswerCard
        searching={false}
        onOpen={() => undefined}
        text={'I found this in ~/Downloads/razorpay-setup.md. [S1]\n\n[S1] ~/Downloads/razorpay-setup.md\nThe Razorpay key setup uses key_id from the dashboard.'}
        citations={[
          { title: '~/Downloads/razorpay-setup.md', filePath: '/Users/me/Downloads/razorpay-setup.md' },
          { title: '~/Downloads/gst-return.pdf', filePath: '/Users/me/Downloads/gst-return.pdf' },
        ]}
      />
    </Frame>
  )
}

const theme = new URLSearchParams(window.location.search).get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.dataset.theme = theme
createRoot(document.getElementById('root')!).render(<Gallery />)
