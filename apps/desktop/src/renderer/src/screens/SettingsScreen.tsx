import { useEffect, useState } from 'react'
import { ThemeSwitch } from '@surf/ui'
import type { ModelStatus, SettingsPatch } from '../../../shared/ipc-contract'

export function SettingsScreen({
  status,
  settings,
  onPatch,
  onCheckUpdates,
}: {
  status: ModelStatus
  settings: Required<SettingsPatch>
  onPatch: (p: SettingsPatch) => void
  onCheckUpdates: () => Promise<string>
}) {
  const [updateNote, setUpdateNote] = useState('')
  const [apiBase, setApiBase] = useState(settings.apiBaseUrl)
  useEffect(() => { setApiBase(settings.apiBaseUrl) }, [settings.apiBaseUrl])
  const apiOk = /^https?:\/\/\S+$/.test(apiBase)

  return (
    <section className="flex-1 overflow-auto px-8 py-8">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
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
          <p className="mt-1">Signed knowledge packs land on a later day. See docs/STEP-3.md.</p>
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
