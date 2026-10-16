import { useEffect, useState, type ReactNode } from 'react'
import { ThemeSwitch } from '@surf/ui'
import { product } from '@surf/shared'
import type { CodeStorageUsage, DeviceInfo, ModelStatus, SettingsPatch, WebCacheStatus } from '../../../shared/ipc-contract'
import { formatIndexBytes } from '../format'
import { DevWebPanel } from './DevWebPanel'
import { activeChatModel, activeCodeModel, chatModels, codeModels, ModelPanel } from './ModelsScreen'

export function SettingsScreen({
  status,
  settings,
  account,
  devices,
  plan,
  termMonths,
  subscriptionEndsAt,
  knowledgePack,
  licenceNote,
  onPatch,
  onCheckUpdates,
  onSignIn,
  onSignOut,
  onRevoke,
  onDeactivate,
  progress,
  busyId,
  error,
  onDownload,
  onSelectModel,
}: {
  status: ModelStatus
  settings: Required<SettingsPatch>
  account: { email: string; deviceId: string | null; plan?: string | null } | null
  devices: DeviceInfo[]
  plan: string | null
  termMonths: number | null
  subscriptionEndsAt: string | null
  knowledgePack: { version: string | null; syncedAt: number | null } | null
  licenceNote: string | null
  onPatch: (p: SettingsPatch) => void
  onCheckUpdates: () => Promise<string>
  onSignIn: () => void
  onSignOut: () => void
  onRevoke: (deviceId: string) => void
  onDeactivate: () => void
  progress: Record<string, number>
  busyId: string | null
  error: string | null
  onDownload: (id: string) => void
  onSelectModel: (id: string) => void
}) {
  const [updateNote, setUpdateNote] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [codeOpen, setCodeOpen] = useState(false)
  const [apiBase, setApiBase] = useState(settings.apiBaseUrl)
  const chats = chatModels(status)
  const code = codeModels(status)
  const current = activeChatModel(status)
  const codeCurrent = activeCodeModel(status)
  useEffect(() => { setApiBase(settings.apiBaseUrl) }, [settings.apiBaseUrl])
  const apiOk = /^https?:\/\/\S+$/.test(apiBase)

  return (
    <section className="flex-1 overflow-auto px-8 py-8">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Group title="Account">
        <div className="card px-4 py-4" data-account="yes">
          <div className="text-sm font-semibold">Account</div>
          <p className="mt-1 text-sm" data-licence-plan="yes">Plan: {plan ?? 'None'}{termMonths ? ` · ${termMonths} ${termMonths === 1 ? 'month' : 'months'}` : ''}</p>
          {subscriptionEndsAt && <p className="mt-1 text-sm" data-licence-ends="yes">Ends: {subscriptionEndsAt.slice(0, 10)}</p>}
          <p className="mt-1 text-sm" data-knowledge-pack="yes">
            {knowledgePack?.version
              ? `Knowledge pack: v${knowledgePack.version}, last synced ${knowledgePack.syncedAt ? new Date(knowledgePack.syncedAt).toISOString().slice(0, 10) : 'not yet'}`
              : 'Knowledge pack: not installed'}
          </p>
          {licenceNote && <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{licenceNote}</p>}
          {account ? (
            <p className="mt-1 text-sm text-[var(--muted)]">Signed in as {account.email}</p>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
              {status.devWeb
                ? 'Dev web search does not need an account. Sign in to see every computer on this licence and to sync packs. A licence key activates this computer on its own.'
                : 'Sign in to see every computer on this licence and to search the web. A licence key activates this computer on its own. Local chat and documents work without an account.'}
            </p>
          )}
          <ul className="mt-3 flex flex-col gap-2">
            {devices.filter((device) => device.status === 'active').map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3 text-sm" data-device={device.current ? 'current' : 'other'}>
                <span>{device.name} · {device.os}{device.current ? ' · this device' : ''}</span>
                <button className="btn btn-ghost" type="button" onClick={() => (device.current ? onDeactivate() : onRevoke(device.id))}>Remove</button>
              </li>
            ))}
          </ul>
          <button className="btn btn-ghost mt-3" type="button" data-deactivate-device="yes" onClick={onDeactivate}>Deactivate this device</button>
          {account ? (
            <button className="btn btn-ghost mt-3" type="button" data-sign-out="yes" onClick={onSignOut}>Sign out</button>
          ) : (
            <button className="btn btn-primary mt-3" type="button" data-sign-in="yes" onClick={onSignIn}>Sign in</button>
          )}
        </div>
        </Group>
        <Group title="Models">
          <div className="card px-4 py-4">
            <ModelPanel
              status={status}
              chats={chats}
              current={current}
              progress={progress}
              busyId={busyId}
              error={error}
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((open) => !open)}
              onDownload={onDownload}
              onSelect={onSelectModel}
            />
            {code.length > 0 && (
              <div className="mt-6">
                <ModelPanel
                  status={status}
                  heading="Code"
                  intro="Qwen3.5 2B is the default. Gemma 4 is optional. If you do not pick, Qwen3.5 2B downloads."
                  chats={code}
                  current={codeCurrent}
                  progress={progress}
                  busyId={busyId}
                  error={null}
                  detailsOpen={codeOpen}
                  onToggleDetails={() => setCodeOpen((open) => !open)}
                  onDownload={onDownload}
                  onSelect={onSelectModel}
                />
              </div>
            )}
          </div>
        </Group>
        <Group title="Privacy and permissions">
        <Row
          title="Offline only"
          body="No network calls for answers, downloads, or update checks."
          on={settings.offlineOnly}
          onToggle={() => onPatch({ offlineOnly: !settings.offlineOnly })}
        />
        <Row
          title="Allow web search"
          body="When you are online and local sources are thin, Synap.surf may search the web. Your documents stay on this computer. Only the short search queries are sent."
          on={settings.webSearchAllowed}
          onToggle={() => onPatch({ webSearchAllowed: !settings.webSearchAllowed })}
        />
        <SavedWebCard />
        <CodeIndexCard />
        <Row
          title="Telemetry"
          body="Off unless you turn it on. Prompts stay on this computer."
          on={settings.telemetryOptIn}
          onToggle={() => onPatch({ telemetryOptIn: !settings.telemetryOptIn })}
        />
        {status.devWeb ? (
          <DevWebPanel apiUrl={status.devApiUrl || 'http://127.0.0.1:8000'} />
        ) : (
          <div className="card px-4 py-4">
            <div className="text-sm font-semibold">Web search service</div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
              Used only when web search is on and you are online. Documents stay on this computer.
            </p>
            <input
              className="field mt-3"
              value={apiBase}
              spellCheck={false}
              aria-label="Search service address"
              onChange={(e) => setApiBase(e.target.value.trim())}
              onBlur={() => { if (apiOk && apiBase !== settings.apiBaseUrl) onPatch({ apiBaseUrl: apiBase }) }}
            />
            {!apiOk && <p className="mt-2 text-sm text-[var(--muted)]">Use an http or https address.</p>}
          </div>
        )}
        </Group>
        <Group title="Connectors">
          <div className="card px-4 py-4 text-sm leading-relaxed text-[var(--muted)]">
            <p>Assistant can draft email and look at a calendar, Slack, or Drive after those accounts are connected. Connecting accounts is not in this beta. Send and delete still wait for your approval.</p>
            <p className="mt-2">Code chats about the code you are writing. You can attach a screenshot. It is not for trading or high-frequency trading. A live code preview is not in this beta.</p>
          </div>
        </Group>
        <Group title="Updates">
        <div className="card px-4 py-4 text-sm leading-relaxed text-[var(--muted)]">
          <div className="font-semibold text-[var(--ink)]">On this computer</div>
          <p className="mt-2">Chats: {status.chatPersistence === 'encrypted' ? 'encrypted SQLite' : 'this session only (OS keychain unavailable)'}.</p>
          <p className="mt-1">Search service: {status.devApiUrl || settings.apiBaseUrl}.</p>
          <p className="mt-3">
            <span className="font-semibold text-[var(--ink)]">Knowledge packs.</span> While a subscription is active and this computer is online, Synap.surf checks for a newer signed pack on startup and every 24 hours. The new pack is swapped in between messages.
          </p>
          <button
            className="btn btn-ghost mt-3"
            type="button"
            onClick={() => { void onCheckUpdates().then(setUpdateNote) }}
          >
            Check for updates
          </button>
          {updateNote && <p className="mt-2">{updateNote}</p>}
          <div className="mt-4">
            <span className="font-semibold text-[var(--ink)]">Update channel</span>
            <div className="mt-2 flex gap-2">
              {(['stable', 'beta'] as const).map((channel) => (
                <button
                  key={channel}
                  type="button"
                  className={settings.updateChannel === channel ? 'btn btn-primary' : 'btn btn-ghost'}
                  data-update-channel={channel}
                  onClick={() => onPatch({ updateChannel: channel })}
                >
                  {channel === 'stable' ? 'Stable' : 'Beta'}
                </button>
              ))}
            </div>
            <p className="mt-2">Beta includes tags that contain -beta. Stable does not.</p>
          </div>
        </div>
        </Group>
        <Group title="About">
        <div className="card px-4 py-4 text-sm leading-relaxed" data-about="yes">
          <div className="font-semibold text-[var(--ink)]">Appearance</div>
          <p className="mt-1 text-[var(--muted)]">Light or dark. Saved on this device.</p>
          <div className="mt-3">
            <ThemeSwitch value={settings.theme} onChange={(theme) => onPatch({ theme })} />
          </div>
          <div className="mt-4 font-semibold text-[var(--ink)]">About</div>
          <p className="mt-2 text-[var(--muted)]">Synap.surf runs on this computer. The notes below are drafts, not legal advice.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <AboutLink href={`${product.site}/privacy`}>Privacy</AboutLink>
            <AboutLink href={`${product.site}/security`}>Security</AboutLink>
            <AboutLink href={`${product.site}/contribute`}>Contribute</AboutLink>
            <AboutLink href={`${product.site}/terms`}>Terms</AboutLink>
            <AboutLink href={product.repo}>GitHub</AboutLink>
          </div>
        </div>
        </Group>
      </div>
    </section>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" data-settings-group={title}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{title}</h2>
      {children}
    </section>
  )
}

function SavedWebCard() {
  const [status, setStatus] = useState<WebCacheStatus | null>(null)
  useEffect(() => {
    void window.surf.webCache.status().then(setStatus).catch(() => setStatus(null))
  }, [])
  return (
    <div className="card px-4 py-4" data-saved-web-card="yes">
      <div className="text-sm font-semibold">Saved web sources</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
        When an answer cites a web page, Surf keeps that passage on this computer so a later question can use it offline. Passages are not uploaded. The store holds {webSize(status?.capBytes ?? 8 * 1024 * 1024)} and drops the least recently used passages after that.
      </p>
      <p className="mt-2 text-sm" data-saved-web-size="yes">
        {status ? `${status.count} passage${status.count === 1 ? '' : 's'} · ${webSize(status.bytes)}` : 'Checking size…'}
      </p>
      <button
        className="btn btn-ghost mt-3"
        type="button"
        data-clear-web="yes"
        onClick={() => { void window.surf.webCache.clear().then(setStatus).catch(() => undefined) }}
      >
        Clear saved web sources
      </button>
    </div>
  )
}

function CodeIndexCard() {
  const [usage, setUsage] = useState<CodeStorageUsage | null>(null)
  useEffect(() => {
    void window.surf.code.storage().then(setUsage).catch(() => setUsage(null))
  }, [])
  return (
    <div className="card px-4 py-4" data-code-index-card="yes">
      <div className="text-sm font-semibold">Code project indexes</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
        Opening a project folder indexes it on this computer. The index stays in the app private data folder. Source files are not uploaded.
      </p>
      <p className="mt-2 text-sm" data-code-index-size="yes">
        {usage ? `${usage.projects.length} project${usage.projects.length === 1 ? '' : 's'} · ${formatIndexBytes(usage.totalBytes)}` : 'Checking size…'}
      </p>
      {usage && usage.projects.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm text-[var(--muted)]">
          {usage.projects.map((project) => (
            <li key={project.id}>{folderLabel(project.root)} · {formatIndexBytes(project.bytes)}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function folderLabel(root: string): string {
  const parts = root.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? root
}

function webSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function AboutLink({ href, children }: { href: string; children: string }) {
  return (
    <button type="button" className="text-[var(--accent-text)]" onClick={() => { void window.surf.links.open(href) }}>
      {children}
    </button>
  )
}

function Row({ title, body, on, onToggle }: { title: string; body: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="card flex items-start justify-between gap-4 px-4 py-4">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
      </div>
      <button type="button" className="toggle mt-1" data-on={on ? 'yes' : 'no'} aria-pressed={on} onClick={onToggle}><span /></button>
    </div>
  )
}
