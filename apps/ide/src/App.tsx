import { useState, useEffect, useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import { Octokit } from '@octokit/rest'
import {
  Github, GitBranch, Send, X, FolderOpen, File, Search,
  GitCommit, Sparkles, Wifi, WifiOff, ChevronRight, ChevronDown,
  Lock, Globe, Loader, AlertCircle, CheckCircle2, Code2,
} from 'lucide-react'
import { VirtualFS, type TreeNode } from './fs/virtual-fs'
import { fetchUserRepos, loadRepoIntoFS, commitAndPR, type GHRepo } from './fs/github-sync'
import { requestDeviceCode, pollForToken } from './auth/github-oauth'
import { agentBridge, type AgentEdit } from './agent/agent-bridge'

/* ────────────────────────────────────────────────────────────────────────── */
/* Types                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */
interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  pending?: boolean
}

type Screen = 'auth' | 'repos' | 'ide'

const vfs = new VirtualFS()

/* ────────────────────────────────────────────────────────────────────────── */
/* Auth Screen                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */
function AuthScreen({ onToken }: { onToken: (token: string) => void }) {
  const [phase, setPhase] = useState<'idle' | 'polling' | 'done'>('idle')
  const [userCode, setUserCode] = useState('')
  const [verificationUri, setVerificationUri] = useState('')
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const startFlow = async () => {
    setError('')
    setPhase('polling')
    try {
      const state = await requestDeviceCode()
      setUserCode(state.userCode)
      setVerificationUri(state.verificationUri)
      window.open(state.verificationUri, '_blank')
      abortRef.current = new AbortController()
      const result = await pollForToken(state.deviceCode, state.interval, abortRef.current.signal)
      setPhase('done')
      onToken(result.accessToken)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError((err as Error).message)
      setPhase('idle')
    }
  }

  useEffect(() => () => { abortRef.current?.abort() }, [])

  return (
    <div className="ide-auth-screen">
      <div className="ide-auth-card">
        <div className="ide-auth-logo">Synap<span>IDE</span></div>
        <p className="ide-auth-tagline">
          Connect any GitHub repository and let the local AI<br />
          agent read, write, and commit code for you.
        </p>

        {phase === 'idle' && (
          <>
            <button className="ide-auth-btn" onClick={startFlow}>
              <Github size={18} />
              Connect GitHub Account
            </button>
            <p className="ide-auth-note">
              Uses GitHub Device Flow — your token never leaves this browser.
              <br />Requires <strong>repo</strong> and <strong>read:user</strong> scopes.
            </p>
          </>
        )}

        {phase === 'polling' && userCode && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ color: 'var(--ide-muted)', marginBottom: 14, fontSize: 13 }}>
              GitHub opened in a new tab. Enter this code:
            </p>
            <div style={{
              fontSize: 28, fontWeight: 700, letterSpacing: '0.15em',
              color: 'var(--ide-accent2)', marginBottom: 16,
              fontFamily: 'var(--ide-mono)',
            }}>
              {userCode}
            </div>
            <a href={verificationUri} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--ide-muted)', textDecoration: 'underline' }}>
              {verificationUri}
            </a>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20, color: 'var(--ide-muted)', fontSize: 12 }}>
              <div className="ide-spinner" />
              Waiting for authorisation…
            </div>
          </div>
        )}

        {phase === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--ide-green)', fontSize: 14 }}>
            <CheckCircle2 size={18} />
            Authorised! Loading your repositories…
          </div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ide-red)', fontSize: 12, marginTop: 16 }}>
            <AlertCircle size={14} />
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Repo Picker                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */
function RepoPicker({ octokit, onSelect }: {
  octokit: Octokit
  onSelect: (repo: GHRepo) => void
}) {
  const [repos, setRepos] = useState<GHRepo[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchUserRepos(octokit)
      .then(setRepos)
      .finally(() => setLoading(false))
  }, [octokit])

  const filtered = repos.filter(r =>
    r.fullName.toLowerCase().includes(query.toLowerCase()) ||
    (r.description ?? '').toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="ide-repo-picker">
      <div className="ide-repo-picker-inner">
        <h1>Pick a repository</h1>
        <p>Select a repo to open in the AI IDE. The local model will index it automatically.</p>

        <div className="ide-search-bar">
          <Search size={14} style={{ color: 'var(--ide-muted)', flex: 'none' }} />
          <input
            autoFocus
            placeholder="Search repositories…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ide-muted)', padding: '20px 0', fontSize: 13 }}>
            <div className="ide-spinner" /> Loading repositories…
          </div>
        )}

        <div className="ide-repo-list">
          {filtered.map(repo => (
            <div key={repo.fullName} className="ide-repo-card" onClick={() => onSelect(repo)}>
              <div className="ide-repo-icon">
                {repo.private ? <Lock size={16} /> : <Globe size={16} />}
              </div>
              <div className="ide-repo-info">
                <div className="ide-repo-name">{repo.fullName}</div>
                <div className="ide-repo-desc">{repo.description ?? 'No description'}</div>
              </div>
              <div className="ide-repo-meta">
                {repo.language && <span className="ide-repo-lang">{repo.language}</span>}
                {repo.private && <span className="ide-repo-private">Private</span>}
                <ChevronRight size={14} style={{ color: 'var(--ide-muted)' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* File Tree                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */
function FileTreeNode({
  node, depth, activeFile, dirtyPaths, onSelect, octokit, owner, repo,
}: {
  node: TreeNode; depth: number; activeFile: string; dirtyPaths: Set<string>
  onSelect: (path: string, content: string) => void
  octokit: Octokit; owner: string; repo: string
}) {
  const [open, setOpen] = useState(depth < 1)

  const handleFile = async () => {
    let file = vfs.get(node.path)
    if (!file) return
    if (!file.content) {
      try {
        const { fetchFileContent } = await import('./fs/github-sync')
        const { content, sha } = await fetchFileContent(octokit, owner, repo, node.path)
        vfs.set(node.path, content, sha)
        file = vfs.get(node.path)!
      } catch { return }
    }
    onSelect(file.path, file.content)
  }

  if (node.type === 'dir') {
    return (
      <div>
        <div
          className="ide-tree-item dir"
          style={{ paddingLeft: 12 + depth * 12 }}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={12} className="ide-tree-icon" /> : <ChevronRight size={12} className="ide-tree-icon" />}
          <FolderOpen size={13} className="ide-tree-icon" style={{ color: 'var(--ide-accent2)' }} />
          {node.name}
        </div>
        {open && node.children?.map(child => (
          <FileTreeNode
            key={child.path} node={child} depth={depth + 1}
            activeFile={activeFile} dirtyPaths={dirtyPaths}
            onSelect={onSelect} octokit={octokit} owner={owner} repo={repo}
          />
        ))}
      </div>
    )
  }

  const isDirty = dirtyPaths.has(node.path)
  return (
    <div
      className={`ide-tree-item ${activeFile === node.path ? 'active' : ''}`}
      style={{ paddingLeft: 12 + depth * 12 }}
      onClick={handleFile}
    >
      <File size={12} className="ide-tree-icon" />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.name}</span>
      {isDirty && <div className="ide-changed-dot" />}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Commit Modal                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */
function CommitModal({ dirtyCount, onCommit, onClose }: {
  dirtyCount: number
  onCommit: (branch: string, message: string, prTitle: string) => Promise<void>
  onClose: () => void
}) {
  const [branch, setBranch] = useState(`ai/changes-${Date.now().toString(36)}`)
  const [message, setMessage] = useState('feat: AI-assisted changes')
  const [prTitle, setPrTitle] = useState('AI-assisted changes via Synap IDE')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      await onCommit(branch, message, prTitle)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ide-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ide-modal">
        <h2>Commit {dirtyCount} changed file{dirtyCount !== 1 ? 's' : ''}</h2>
        <p>Creates a new branch and opens a Pull Request on GitHub.</p>

        <label style={{ display: 'block', fontSize: 11, color: 'var(--ide-muted)', marginBottom: 4 }}>Branch name</label>
        <input className="ide-input" value={branch} onChange={e => setBranch(e.target.value)} placeholder="branch-name" />

        <label style={{ display: 'block', fontSize: 11, color: 'var(--ide-muted)', marginBottom: 4 }}>Commit message</label>
        <input className="ide-input" value={message} onChange={e => setMessage(e.target.value)} placeholder="feat: describe changes" />

        <label style={{ display: 'block', fontSize: 11, color: 'var(--ide-muted)', marginBottom: 4 }}>PR title</label>
        <input className="ide-input" value={prTitle} onChange={e => setPrTitle(e.target.value)} placeholder="Pull request title" />

        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ide-red)', fontSize: 12, marginBottom: 12 }}>
            <AlertCircle size={13} />{error}
          </div>
        )}

        <div className="ide-modal-actions">
          <button className="ide-btn ide-btn-ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="ide-btn ide-btn-primary" onClick={submit} disabled={loading || !branch || !message}>
            {loading ? <><div className="ide-spinner" style={{ width: 12, height: 12 }} /> Pushing…</> : <><GitCommit size={13} /> Push & Open PR</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* IDE Shell                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */
function IDEShell({ octokit, repo }: { octokit: Octokit; repo: GHRepo }) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState('')
  const [editorContent, setEditorContent] = useState('')
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadProgress, setLoadProgress] = useState(0)
  const [messages, setMessages] = useState<Message[]>([])
  const [prompt, setPrompt] = useState('')
  const [agentRunning, setAgentRunning] = useState(false)
  const [connected, setConnected] = useState(false)
  const [showCommitModal, setShowCommitModal] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Parameters<NonNullable<React.ComponentProps<typeof Editor>['onMount']>>[0] | null>(null)

  // Init: connect agent bridge + load repo
  useEffect(() => {
    agentBridge.onConnectionChange = setConnected
    agentBridge.connect()

    loadRepoIntoFS(
      octokit, repo.owner, repo.name, repo.defaultBranch, vfs,
      (loaded, total) => setLoadProgress(Math.round((loaded / total) * 100)),
    ).then(() => {
      setTree(vfs.tree())
      setLoading(false)
    })

    return () => {
      agentBridge.disconnect()
      vfs.clear()
    }
  }, [octokit, repo])

  // Scroll chat on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const openFile = useCallback((path: string, content: string) => {
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path])
    setActiveTab(path)
    setEditorContent(content)
  }, [])

  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const idx = openTabs.indexOf(path)
    const next = openTabs.filter(t => t !== path)
    setOpenTabs(next)
    if (activeTab === path) {
      const newActive = next[Math.max(0, idx - 1)] ?? ''
      setActiveTab(newActive)
      setEditorContent(newActive ? vfs.get(newActive)?.content ?? '' : '')
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    if (!activeTab || value === undefined) return
    vfs.edit(activeTab, value)
    setEditorContent(value)
    setDirtyPaths(new Set(vfs.dirtyFiles().map(f => f.path)))
  }

  const applyAgentEdits = useCallback((edits: AgentEdit[]) => {
    for (const edit of edits) {
      vfs.edit(edit.path, edit.content)
      if (activeTab === edit.path) setEditorContent(edit.content)
    }
    setDirtyPaths(new Set(vfs.dirtyFiles().map(f => f.path)))
    setTree(vfs.tree())
  }, [activeTab])

  const sendPrompt = () => {
    if (!prompt.trim() || agentRunning) return
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: prompt.trim() }
    const agentMsg: Message = { id: crypto.randomUUID(), role: 'agent', content: '', pending: true }
    setMessages(prev => [...prev, userMsg, agentMsg])
    setPrompt('')
    setAgentRunning(true)

    const pendingEdits: AgentEdit[] = []
    // Build context from open files (max 8)
    const contextFiles: Record<string, string> = {}
    for (const tab of openTabs.slice(-8)) {
      const f = vfs.get(tab)
      if (f) contextFiles[tab] = f.content
    }

    agentBridge.send(
      userMsg.content,
      { files: contextFiles, activeFile: activeTab },
      {
        onToken: (token) => {
          setMessages(prev => prev.map(m =>
            m.id === agentMsg.id ? { ...m, content: m.content + token } : m,
          ))
        },
        onEdit: (edit) => { pendingEdits.push(edit) },
        onDone: () => {
          setMessages(prev => prev.map(m =>
            m.id === agentMsg.id ? { ...m, pending: false } : m,
          ))
          if (pendingEdits.length) applyAgentEdits(pendingEdits)
          setAgentRunning(false)
        },
        onError: (err) => {
          setMessages(prev => prev.map(m =>
            m.id === agentMsg.id ? { ...m, content: `Error: ${err}`, pending: false } : m,
          ))
          setAgentRunning(false)
        },
      },
    )
  }

  const handleCommit = async (branch: string, message: string, prTitle: string) => {
    const { prUrl: url } = await commitAndPR(
      octokit, repo.owner, repo.name, repo.defaultBranch,
      branch, message, prTitle,
      `This PR was generated by [Synap IDE](https://synap.surf) using the local AI agent.\n\n---\n*Zero cloud inference — code never left this machine.*`,
      vfs,
    )
    setDirtyPaths(new Set())
    setPrUrl(url)
    setShowCommitModal(false)
  }

  const dirtyCount = dirtyPaths.size

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16, color: 'var(--ide-muted)' }}>
        <div style={{ position: 'relative', width: 48, height: 48 }}>
          <div className="ide-spinner" style={{ width: 48, height: 48, borderWidth: 3 }} />
        </div>
        <div style={{ fontSize: 13 }}>Indexing {repo.fullName} — {loadProgress}%</div>
      </div>
    )
  }

  return (
    <div className="ide-shell">
      {/* Top Bar */}
      <header className="ide-topbar">
        <div className="ide-topbar-logo">
          <Code2 size={16} style={{ color: 'var(--ide-accent2)' }} />
          Synap<span>IDE</span>
        </div>
        <div className="ide-topbar-branch">
          <GitBranch size={12} />
          {repo.defaultBranch}
        </div>
        <span style={{ fontSize: 12, color: 'var(--ide-muted)' }}>{repo.fullName}</span>

        <div className="ide-topbar-actions">
          {prUrl && (
            <a href={prUrl} target="_blank" rel="noreferrer" className="ide-btn ide-btn-green" style={{ fontSize: 11 }}>
              <CheckCircle2 size={12} /> PR opened ↗
            </a>
          )}
          <button
            className="ide-btn ide-btn-primary"
            onClick={() => setShowCommitModal(true)}
            disabled={dirtyCount === 0}
          >
            <GitCommit size={13} />
            Commit {dirtyCount > 0 ? `${dirtyCount} file${dirtyCount !== 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="ide-sidebar">
        <div className="ide-sidebar-header">
          <span>Explorer</span>
          {dirtyCount > 0 && (
            <span style={{ color: 'var(--ide-yellow)', fontSize: 10, fontWeight: 700 }}>
              {dirtyCount} changed
            </span>
          )}
        </div>
        <div className="ide-file-tree">
          {tree.map(node => (
            <FileTreeNode
              key={node.path} node={node} depth={0}
              activeFile={activeTab} dirtyPaths={dirtyPaths}
              onSelect={openFile} octokit={octokit}
              owner={repo.owner} repo={repo.name}
            />
          ))}
        </div>
      </aside>

      {/* Editor */}
      <main className="ide-editor-area">
        {/* Tabs */}
        <div className="ide-tabs">
          {openTabs.map(tab => {
            const name = tab.split('/').pop() ?? tab
            const dirty = dirtyPaths.has(tab)
            return (
              <div
                key={tab}
                className={`ide-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab(tab)
                  setEditorContent(vfs.get(tab)?.content ?? '')
                }}
              >
                <File size={11} />
                {name}
                {dirty && <div className="ide-changed-dot" style={{ width: 5, height: 5 }} />}
                <div className="ide-tab-close" onClick={e => closeTab(tab, e)}>
                  <X size={10} />
                </div>
              </div>
            )
          })}
        </div>

        {activeTab ? (
          <div className="ide-monaco-wrapper">
            <Editor
              language={vfs.get(activeTab)?.language ?? 'plaintext'}
              value={editorContent}
              theme="vs-dark"
              onChange={handleEditorChange}
              onMount={(editor) => { editorRef.current = editor }}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16, bottom: 16 },
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                cursorBlinking: 'smooth',
                smoothScrolling: true,
                automaticLayout: true,
                tabSize: 2,
              }}
            />
          </div>
        ) : (
          <div className="ide-empty-editor">
            <Code2 size={48} />
            <p>Select a file from the explorer to start editing</p>
            <p style={{ fontSize: 11 }}>or describe what you want in the chat →</p>
          </div>
        )}
      </main>

      {/* Chat Panel */}
      <aside className="ide-chat">
        <div className="ide-chat-header">
          <Sparkles size={14} style={{ color: 'var(--ide-accent2)' }} />
          AI Agent
          <span className="ide-chat-badge">Local</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: connected ? 'var(--ide-green)' : 'var(--ide-muted)' }}>
            {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            {connected ? 'Live' : 'Offline'}
          </div>
        </div>

        <div className="ide-chat-messages">
          {messages.length === 0 && (
            <div style={{ color: 'var(--ide-muted)', fontSize: 12, textAlign: 'center', padding: '24px 8px', lineHeight: 1.7 }}>
              <Sparkles size={24} style={{ marginBottom: 10, opacity: 0.3 }} /><br />
              Describe what you want to build, fix, or refactor.<br />
              <span style={{ fontSize: 11 }}>The AI agent reads your files and edits them directly.</span>
            </div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`ide-message ${msg.role}`}>
              <div className="ide-message-role">{msg.role === 'user' ? 'You' : 'Synap Agent'}</div>
              {msg.pending && !msg.content ? (
                <div className="ide-message-body">
                  <div className="ide-thinking">
                    <div className="ide-thinking-dot" />
                    <div className="ide-thinking-dot" />
                    <div className="ide-thinking-dot" />
                  </div>
                </div>
              ) : (
                <div className="ide-message-body">{msg.content}</div>
              )}
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="ide-chat-input-area">
          {activeTab && (
            <div className="ide-context-chips">
              <div className="ide-chip">
                <File size={10} />
                {activeTab.split('/').pop()}
              </div>
              {dirtyCount > 0 && (
                <div className="ide-chip" style={{ color: 'var(--ide-yellow)', borderColor: 'rgba(251,191,36,0.2)' }}>
                  {dirtyCount} unsaved
                </div>
              )}
            </div>
          )}
          <div className="ide-prompt-box">
            <textarea
              className="ide-prompt-textarea"
              placeholder="Describe what you want to build or fix…"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  sendPrompt()
                }
              }}
            />
            <button
              className="ide-prompt-send"
              onClick={sendPrompt}
              disabled={!prompt.trim() || agentRunning}
              title="Send (⌘Enter)"
            >
              {agentRunning ? <Loader size={13} style={{ animation: 'spin 0.7s linear infinite' }} /> : <Send size={13} />}
            </button>
          </div>
        </div>
      </aside>

      {/* Status Bar */}
      <div className="ide-statusbar">
        <div className="ide-statusbar-item">
          <GitBranch size={10} />
          {repo.defaultBranch}
        </div>
        <span className="sep">|</span>
        <div className="ide-statusbar-item">
          <Code2 size={10} />
          {activeTab ? (vfs.get(activeTab)?.language ?? 'text') : 'no file'}
        </div>
        <span className="sep">|</span>
        <div className="ide-statusbar-item">
          {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
          {connected ? 'Sidecar connected' : 'Sidecar offline'}
        </div>
        {dirtyCount > 0 && (
          <>
            <span className="sep">|</span>
            <div className="ide-statusbar-item" style={{ color: '#fff' }}>
              <div className="ide-changed-dot" style={{ background: '#fff' }} />
              {dirtyCount} unsaved
            </div>
          </>
        )}
        <div style={{ marginLeft: 'auto' }}>Synap IDE · local-first</div>
      </div>

      {/* Commit Modal */}
      {showCommitModal && (
        <CommitModal
          dirtyCount={dirtyCount}
          onCommit={handleCommit}
          onClose={() => setShowCommitModal(false)}
        />
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Root App                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */
export function App() {
  const [screen, setScreen] = useState<Screen>('auth')
  const [octokit, setOctokit] = useState<Octokit | null>(null)
  const [selectedRepo, setSelectedRepo] = useState<GHRepo | null>(null)

  const handleToken = (token: string) => {
    setOctokit(new Octokit({ auth: token }))
    setScreen('repos')
  }

  const handleRepo = (repo: GHRepo) => {
    setSelectedRepo(repo)
    setScreen('ide')
  }

  if (screen === 'auth') return <AuthScreen onToken={handleToken} />
  if (screen === 'repos' && octokit) return <RepoPicker octokit={octokit} onSelect={handleRepo} />
  if (screen === 'ide' && octokit && selectedRepo) return <IDEShell octokit={octokit} repo={selectedRepo} />
  return null
}
