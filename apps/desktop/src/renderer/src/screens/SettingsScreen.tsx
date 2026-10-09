import { useEffect, useState } from 'react'
import { ThemeSwitch } from '@surf/ui'
import type { DeviceInfo, ModelStatus, SettingsPatch, WebCacheStatus } from '../../../shared/ipc-contract'

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
}) {
  const [updateNote, setUpdateNote] = useState('')
  const [apiBase, setApiBase] = useState(settings.apiBaseUrl)
  useEffect(() => { setApiBase(settings.apiBaseUrl) }, [settings.apiBaseUrl])
  const apiOk = /^https?:\/\/\S+$/.test(apiBase)

  return (
    <section className="flex-1 overflow-auto px-8 py-8">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
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
        <Row
          title="Offline only"
          body="No network calls for answers, downloads, or update checks."
          on={settings.offlineOnly}
          onToggle={() => onPatch({ offlineOnly: !settings.offlineOnly })}
        />
        <Row
          title="Allow web search"
          body="When you are online and local sources are thin, Surf may search the web. Your documents stay on this computer. Only the short search queries are sent."
          on={settings.webSearchAllowed}
          onToggle={() => onPatch({ webSearchAllowed: !settings.webSearchAllowed })}
        />
        <SavedWebCard />
        <Row
          title="Telemetry"
          body="Off by default. The choice is saved here. Sending counts is not wired yet, and prompts are never included."
          on={settings.telemetryOptIn}
          onToggle={() => onPatch({ telemetryOptIn: !settings.telemetryOptIn })}
        />
        <div className="card px-4 py-4">
          <div className="text-sm font-semibold">Search service</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Production placeholder is https://api.synap.surf. Local development uses http://127.0.0.1:8000.
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
        <div className="card px-4 py-4">
          <div className="text-sm font-semibold">Appearance</div>
          <p className="mt-1 text-sm text-[var(--muted)]">System follows this computer. Your choice is saved on this device.</p>
          <div className="mt-3">
            <ThemeSwitch value={settings.theme} onChange={(theme) => onPatch({ theme })} />
          </div>
        </div>
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
        </div>
      </div>
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
