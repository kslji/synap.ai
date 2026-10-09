import { useEffect, useState } from 'react'
import type { ModelStatus, SettingsPatch } from '../../../shared/ipc-contract'

type Theme = 'system' | 'light' | 'dark'

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
  const [theme, setTheme] = useState<Theme>('system')
  const [updateNote, setUpdateNote] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('surf-theme')
    if (saved === 'light' || saved === 'dark' || saved === 'system') setTheme(saved)
  }, [])

  function chooseTheme(next: Theme) {
    setTheme(next)
    localStorage.setItem('surf-theme', next)
    if (next === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.dataset.theme = next
  }

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
          body="When you are online and local sources are thin, Surf may search. The search proxy lands on Day 4. Until then Surf says when it does not know."
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
          <div className="text-sm font-semibold">Appearance</div>
          <div className="mt-3 flex gap-2">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} type="button" className={`btn ${theme === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => chooseTheme(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="card px-4 py-4 text-sm leading-relaxed text-[var(--muted)]">
          <div className="font-semibold text-[var(--ink)]">On this computer</div>
          <p className="mt-2">Chats: {status.chatPersistence === 'encrypted' ? 'encrypted SQLite' : 'this session only (OS keychain unavailable)'}.</p>
          <p className="mt-1">Local API server: off.</p>
          <p className="mt-1">Niche agents, document attachments, and signed packs land on later days. See docs/STEP-1.md.</p>
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
