import { useEffect, useState, type ReactNode } from 'react'
import { ThemeSwitch } from '@surf/ui'
import { product } from '@surf/shared'
import type { DeviceInfo, ModelStatus, SettingsPatch, WebCacheStatus } from '../../../shared/ipc-contract'
import { activeChatModel, chatModels, ModelPanel } from './ModelsScreen'

export function SettingsScreen({
  status,
  settings,
  account,
  devices,
  onPatch,
  onCheckUpdates,
  onSignIn,
  onSignOut,
  onRevoke,
  progress,
  busyId,
  error,
  onDownload,
  onSelectModel,
}: {
  status: ModelStatus
  settings: Required<SettingsPatch>
  account: { email: string; deviceId: string | null } | null
  devices: DeviceInfo[]
  onPatch: (p: SettingsPatch) => void
  onCheckUpdates: () => Promise<string>
  onSignIn: () => void
  onSignOut: () => void
  onRevoke: (deviceId: string) => void
  progress: Record<string, number>
  busyId: string | null
  error: string | null
  onDownload: (id: string) => void
  onSelectModel: (id: string) => void
}) {
  const [updateNote, setUpdateNote] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [apiBase, setApiBase] = useState(settings.apiBaseUrl)
  const chats = chatModels(status)
  const current = activeChatModel(status)
  useEffect(() => { setApiBase(settings.apiBaseUrl) }, [settings.apiBaseUrl])
  const apiOk = /^https?:\/\/\S+$/.test(apiBase)

  return (
    <section className="flex-1 overflow-auto px-8 py-8">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <Group title="Account">
        <div className="card px-4 py-4" data-account="yes">
          <div className="text-sm font-semibold">Account</div>
          {account ? (
            <>
              <p className="mt-1 text-sm text-[var(--muted)]">Signed in as {account.email}</p>
              <ul className="mt-3 flex flex-col gap-2">
                {devices.filter((device) => device.status === 'active').map((device) => (
                  <li key={device.id} className="flex items-center justify-between gap-3 text-sm" data-device={device.current ? 'current' : 'other'}>
                    <span>{device.name} · {device.os}{device.current ? ' · this device' : ''}</span>
                    <button className="btn btn-ghost" type="button" onClick={() => onRevoke(device.id)}>Revoke</button>
                  </li>
                ))}
              </ul>
              <button className="btn btn-ghost mt-3" type="button" data-sign-out="yes" onClick={onSignOut}>Sign out</button>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">Sign in to search the web and sync packs. Local chat and documents work without an account.</p>
              <button className="btn btn-primary mt-3" type="button" data-sign-in="yes" onClick={onSignIn}>Sign in</button>
            </>
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
        <Row
          title="Telemetry"
          body="Off unless you turn it on. Prompts stay on this computer."
          on={settings.telemetryOptIn}
          onToggle={() => onPatch({ telemetryOptIn: !settings.telemetryOptIn })}
        />
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
        </Group>
        <Group title="Connectors">
          <div className="card px-4 py-4 text-sm leading-relaxed text-[var(--muted)]">
            <p>Assistant can draft email and look at a calendar, Slack, or Drive after those accounts are connected. Connecting accounts is not in this beta. Send and delete still wait for your approval.</p>
            <p className="mt-2">Code + UI chats about code and the screen you are building. It is not for trading or high-frequency trading. A live code preview is not in this beta.</p>
          </div>
        </Group>
        <Group title="Updates">
        <div className="card px-4 py-4 text-sm leading-relaxed text-[var(--muted)]">
          <div className="font-semibold text-[var(--ink)]">On this computer</div>
          <p className="mt-2">Chats: {status.chatPersistence === 'encrypted' ? 'encrypted SQLite' : 'this session only (OS keychain unavailable)'}.</p>
          <p className="mt-1">Search service: {settings.apiBaseUrl}.</p>
          <label className="mt-3 block">
            <span className="font-semibold text-[var(--ink)]">Pack check interval (hours)</span>
            <input
              className="field mt-2"
              type="number"
              min={1}
              max={168}
              value={settings.packSyncHours}
              aria-label="Pack check interval"
              onChange={(e) => {
                const hours = Number(e.target.value)
                if (hours >= 1 && hours <= 168) onPatch({ packSyncHours: hours })
              }}
            />
          </label>
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
