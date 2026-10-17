import { useEffect, useState, type ReactNode } from 'react'
import { Cpu, Database, HardDrive, Hash, MemoryStick, Monitor, Palette, Plug, Shield, Text, Wifi } from 'lucide-react'
import { product } from '@surf/shared'
import { BLOB_SWATCHES, BlobMascot } from '@surf/ui'
import { BOT_NAME_LIMIT, cleanMascotName } from '../../../main/core/appearance'
import { AUTO_MODE_SUMMARY, type CodeStorageUsage, type DeviceInfo, type LicenceStatus, type ModelStatus, type SettingsPatch, type WebCacheStatus } from '../../../shared/ipc-contract'
import { cleanCpuName, formatContextTokens, formatPromptCache, formatRamGb } from '../../../shared/hardware-label'
import { friendlyModelName } from '../../../shared/model-label'
import { formatIndexBytes } from '../format'
import { useMascotActivity } from '../mascot-activity'
import { DevWebPanel } from './DevWebPanel'
import { chatModels, listedCodeModels, ModelPanel } from './ModelsScreen'
import { LiveFeelSettings, StoragePanel } from './UsageStorage'
import { FilePermissionsPanel } from './FilePermissions'

export function SettingsScreen({
  status,
  settings,
  account,
  devices,
  licenceState,
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
  onBack,
  onSave,
  onRestore,
}: {
  status: ModelStatus
  settings: Required<SettingsPatch>
  account: { email: string; deviceId: string | null; plan?: string | null } | null
  devices: DeviceInfo[]
  licenceState: LicenceStatus['state']
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
  onBack: () => void
  onSave: () => void
  onRestore: () => void
}) {
  const [category, setCategory] = useState<SettingsCategory>('general')
  const [savedNote, setSavedNote] = useState('')
  const [updateNote, setUpdateNote] = useState('')
  const [apiBase, setApiBase] = useState(settings.apiBaseUrl)
  const [region, setRegion] = useState(settings.myRegion)
  const chats = chatModels(status)
  const code = listedCodeModels(status)
  useEffect(() => { setApiBase(settings.apiBaseUrl) }, [settings.apiBaseUrl])
  useEffect(() => { setRegion(settings.myRegion) }, [settings.myRegion])
  const apiOk = /^https?:\/\/\S+$/.test(apiBase)

  function save() {
    onSave()
    setSavedNote('Saved on this computer.')
  }

  return (
    <section className="settings-shell flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 px-8 py-6">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">Preferences stay on this computer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {licenceState === 'dev' && <span className="pill" data-dev-mode="yes">Dev mode</span>}
          {status.appVersion ? <span className="text-sm text-[var(--muted)]" data-app-version="yes">Version {status.appVersion}</span> : null}
          <button className="btn btn-ghost" type="button" data-back-chat="yes" onClick={onBack}>Back to Chat</button>
          <button className="btn btn-primary" type="button" data-save-settings="yes" onClick={save}>Save Changes</button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="settings-nav flex w-[240px] shrink-0 flex-col gap-1 overflow-auto px-3 py-4" aria-label="Settings categories">
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon
            return (
            <button
              key={item.id}
              type="button"
              data-settings-nav={item.id}
              aria-current={category === item.id ? 'page' : undefined}
              className="settings-nav-btn"
              onClick={() => setCategory(item.id)}
            >
              <Icon size={16} />
              {item.label}
            </button>
            )
          })}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto px-8 py-6">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {category === 'storage' && <Group title="Account">
        <div className="card px-4 py-4" data-account="yes">
          <div className="text-sm font-semibold">Account</div>
          <p className="mt-1 text-sm" data-licence-plan="yes">
            {licenceState === 'dev' ? 'Dev mode' : 'Subscription term comes from the licence on this computer.'}
            {termMonths ? ` · ${termMonths} ${termMonths === 1 ? 'month' : 'months'}` : ''}
          </p>
          {status.appVersion ? <p className="mt-1 text-sm">Version {status.appVersion}</p> : null}
          {subscriptionEndsAt && <p className="mt-1 text-sm" data-licence-ends="yes">Ends: {subscriptionEndsAt.slice(0, 10)}</p>}
          <p className="mt-1 text-sm" data-knowledge-pack="yes">
            {knowledgePack?.version
              ? `Knowledge pack: v${knowledgePack.version}, last synced ${knowledgePack.syncedAt ? new Date(knowledgePack.syncedAt).toISOString().slice(0, 10) : 'not yet'}`
              : 'Knowledge pack: not installed'}
          </p>
          {licenceNote && <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{licenceNote}</p>}
          {licenceState === 'dev' ? (
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">Chat works on this computer. Sign-in and sync are off.</p>
          ) : account ? (
            <p className="mt-1 text-sm text-[var(--muted)]">Signed in as {account.email}</p>
          ) : (
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
              {status.devWeb
                ? 'Dev web search does not need an account. Sign in to see every computer on this licence and to sync packs. A licence key activates this computer on its own.'
                : 'Sign in to see every computer on this licence and to search the web. A licence key activates this computer on its own. Local chat and documents work without an account.'}
            </p>
          )}
          {licenceState !== 'dev' && (
            <>
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
            </>
          )}
        </div>
        </Group>}
        {category === 'general' && <Group title="Appearance">
          <AppearanceCard settings={settings} onPatch={onPatch} />
        </Group>}
        {category === 'general' && <Group title="This computer">
          <MachineCard status={status} />
        </Group>}
        {category === 'models' && <Group title="Models">
          <div className="card px-4 py-4">
            <ModelPanel status={status} chats={chats} />
            <div className="mt-6">
              <ModelPanel status={status} heading="Code" chats={code} />
            </div>
          </div>
        </Group>}
        {category === 'models' && <Group title="Code agent">
          <CodeAgentSettings settings={settings} onPatch={onPatch} />
          <LiveFeelSettings status={status} settings={settings} onPatch={onPatch} />
        </Group>}
        {category === 'permissions' && <Group title="Permissions">
          <FilePermissionsPanel />
        </Group>}
        {category === 'storage' && <Group title="Storage">
          <StoragePanel />
        </Group>}
        {category === 'network' && <Group title="Network">
        <div className="card px-4 py-4" data-network-settings="yes">
          <div className="text-sm font-semibold">Network</div>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Network mode">
            {(['offline', 'online', 'auto'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={settings.networkMode === mode}
                data-network-mode={mode}
                className={settings.networkMode === mode ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => onPatch({ networkMode: mode })}
              >
                {mode === 'offline' ? 'Offline' : mode === 'online' ? 'Online' : 'Auto'}
              </button>
            ))}
          </div>
          {status.sync && <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]" data-sync-detail="yes">{status.sync.detail}</p>}
          {status.sync?.refreshWarning && <p className="mt-2 text-sm leading-relaxed" data-licence-refresh="yes">{status.sync.refreshWarning}</p>}
        </div>
        <Row
          title="Allow web search"
          body="Look up pages when you are online. Your files stay here."
          on={settings.webSearchAllowed}
          onToggle={() => onPatch({ webSearchAllowed: !settings.webSearchAllowed })}
        />
        <div className="card px-4 py-4">
          <div className="text-sm font-semibold">My region</div>
          <input
            className="field mt-3"
            value={region}
            spellCheck={false}
            aria-label="My region"
            placeholder="Country"
            maxLength={80}
            onChange={(e) => setRegion(e.target.value)}
            onBlur={() => { if (region.trim() !== settings.myRegion) onPatch({ myRegion: region.trim() }) }}
          />
        </div>
        <SavedWebCard />
        <CodeIndexCard />
        <Row
          title="Telemetry"
          body="Off until you turn it on. Chats stay on this computer."
          on={settings.telemetryOptIn}
          onToggle={() => onPatch({ telemetryOptIn: !settings.telemetryOptIn })}
        />
        {licenceState === 'dev' ? (
          <div className="card px-4 py-4">
            <div className="text-sm font-semibold">Account and pack server</div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">Dev mode, sync off.</p>
          </div>
        ) : status.devWeb ? (
          <DevWebPanel apiUrl={status.devApiUrl || 'http://127.0.0.1:8000'} />
        ) : (
          <div className="card px-4 py-4">
            <div className="text-sm font-semibold">Account and pack server</div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
              Sign-in, licences, and knowledge-pack updates use this address. Web search runs on this computer and does not use an API key.
            </p>
            <input
              className="field mt-3"
              value={apiBase}
              spellCheck={false}
              aria-label="Account and pack server"
              onChange={(e) => setApiBase(e.target.value.trim())}
              onBlur={() => { if (apiOk && apiBase !== settings.apiBaseUrl) onPatch({ apiBaseUrl: apiBase }) }}
            />
            {!apiOk && <p className="mt-2 text-sm text-[var(--muted)]">Use an http or https address.</p>}
          </div>
        )}
        </Group>}
        {category === 'apps' && <Group title="Connected Apps">
          <div className="card px-4 py-4" data-connected-apps="yes">
            <div className="hw-grid">
              <div className="hw-tile">
                <div className="hw-label">Mail and calendar</div>
                <div className="hw-value">Not in this beta</div>
              </div>
              <div className="hw-tile">
                <div className="hw-label">Code</div>
                <div className="hw-value">On this computer</div>
              </div>
            </div>
          </div>
        </Group>}
        {category === 'network' && <Group title="Updates">
        <div className="card px-4 py-4 text-sm leading-relaxed text-[var(--muted)]">
          <div className="font-semibold text-[var(--ink)]">On this computer</div>
          <p className="mt-2">Chats stay on this computer.</p>
          {licenceState !== 'dev' && <p className="mt-1">Account server: {status.devApiUrl || settings.apiBaseUrl}.</p>}
          <p className="mt-3">
            <span className="font-semibold text-[var(--ink)]">Knowledge packs.</span>{' '}
            {licenceState === 'dev'
              ? 'Dev mode, sync off.'
              : 'When you are online, Synap checks for newer packs.'}
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
            <p className="mt-2">Beta gets early builds. Stable waits.</p>
          </div>
        </div>
        </Group>}
        {category === 'general' && <Group title="About">
        <div className="card px-4 py-4 text-sm leading-relaxed" data-about="yes">
          <div className="font-semibold text-[var(--ink)]">About</div>
          <p className="mt-2 text-[var(--muted)]">Synap.surf runs on this computer.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {licenceState !== 'dev' && (
              <>
                <AboutLink href={`${product.site}/privacy`}>Privacy</AboutLink>
                <AboutLink href={`${product.site}/security`}>Security</AboutLink>
                <AboutLink href={`${product.site}/contribute`}>Contribute</AboutLink>
                <AboutLink href={`${product.site}/terms`}>Terms</AboutLink>
              </>
            )}
            <AboutLink href={product.repo}>GitHub</AboutLink>
          </div>
        </div>
        </Group>}
          </div>
        </div>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-6 py-3">
        {savedNote && <span className="mr-auto text-sm text-[var(--muted)]" data-saved-note="yes">{savedNote}</span>}
        <button className="btn btn-ghost" type="button" data-restore-defaults="yes" onClick={() => { setSavedNote(''); onRestore() }}>Restore Defaults</button>
        <button className="btn btn-primary" type="button" onClick={save}>Save Changes</button>
      </footer>
    </section>
  )
}

const SETTINGS_NAV: { id: SettingsCategory; label: string; icon: typeof Palette }[] = [
  { id: 'general', label: 'General & Appearance', icon: Palette },
  { id: 'models', label: 'Offline Models & Compute', icon: Cpu },
  { id: 'network', label: 'Network', icon: Wifi },
  { id: 'apps', label: 'Connected Apps', icon: Plug },
  { id: 'permissions', label: 'Permissions', icon: Shield },
  { id: 'storage', label: 'Storage', icon: HardDrive },
]

type SettingsCategory = 'general' | 'models' | 'network' | 'apps' | 'permissions' | 'storage'

function CodeAgentSettings({ settings, onPatch }: { settings: Required<SettingsPatch>; onPatch: (p: SettingsPatch) => void }) {
  const [list, setList] = useState(settings.codeAgentAllowlist.join('\n'))
  const [languages, setLanguages] = useState(settings.tabSuggestionsOff.join(', '))
  const [confirming, setConfirming] = useState(false)
  useEffect(() => { setList(settings.codeAgentAllowlist.join('\n')) }, [settings.codeAgentAllowlist])
  useEffect(() => { setLanguages(settings.tabSuggestionsOff.join(', ')) }, [settings.tabSuggestionsOff])
  const mode = settings.codeAgentMode === 'auto' ? 'auto' : 'ask'
  function choose(next: 'ask' | 'auto') {
    if (next === 'ask') {
      setConfirming(false)
      onPatch({ codeAgentMode: 'ask' })
      return
    }
    if (!settings.codeAgentAutoConfirmed) {
      setConfirming(true)
      return
    }
    onPatch({ codeAgentMode: 'auto' })
  }
  return (
    <div className="card px-4 py-4" data-code-agent-settings="yes">
      <div className="text-sm font-semibold">Default mode</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
        New code projects start in Ask. A project can keep its own choice.
      </p>
      <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Default code agent mode">
        <button type="button" className={mode === 'ask' ? 'btn btn-primary' : 'btn btn-ghost'} data-code-default-mode="ask" aria-checked={mode === 'ask'} role="radio" onClick={() => choose('ask')}>Ask</button>
        <button type="button" className={mode === 'auto' ? 'btn btn-primary' : 'btn btn-ghost'} data-code-default-mode="auto" aria-checked={mode === 'auto'} role="radio" onClick={() => choose('auto')}>Auto</button>
      </div>
      {confirming && (
        <div className="mt-3" data-code-auto-settings-confirm="yes">
          <p className="text-sm leading-relaxed">{AUTO_MODE_SUMMARY}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary" data-code-auto-settings-enable="yes" onClick={() => { setConfirming(false); onPatch({ codeAgentMode: 'auto', codeAgentAutoConfirmed: true }) }}>Enable Auto</button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Stay on Ask</button>
          </div>
        </div>
      )}
      <div className="mt-4 text-sm font-semibold">Command allowlist</div>
      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
        Auto may run these commands. One command per line.
      </p>
      <textarea
        className="field mt-3 min-h-24"
        aria-label="Command allowlist"
        data-code-allowlist="yes"
        value={list}
        spellCheck={false}
        onChange={(event) => setList(event.target.value)}
        onBlur={() => {
          const commands = list.split('\n').map((line) => line.trim()).filter(Boolean)
          onPatch({ codeAgentAllowlist: commands })
        }}
      />
      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold">Tab suggestions</div>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Grey text in the editor. Tab accepts it. Nothing is saved until you save.
          </p>
        </div>
        <button type="button" className="toggle mt-1" data-tab-suggestions="yes" data-on={settings.tabSuggestions ? 'yes' : 'no'} aria-pressed={settings.tabSuggestions} onClick={() => onPatch({ tabSuggestions: !settings.tabSuggestions })}><span /></button>
      </div>
      <div className="mt-3 text-sm font-semibold">Languages off</div>
      <p className="mt-1 text-sm text-[var(--muted)]">Comma-separated, such as markdown.</p>
      <input
        className="field mt-2"
        aria-label="Languages with Tab suggestions off"
        data-tab-languages="yes"
        value={languages}
        spellCheck={false}
        onChange={(event) => setLanguages(event.target.value)}
        onBlur={() => {
          const off = languages.split(',').map((item) => item.trim().toLowerCase()).filter((item) => /^[a-z0-9_+-]+$/.test(item))
          onPatch({ tabSuggestionsOff: off })
        }}
      />
    </div>
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
      <div className="text-sm font-semibold">Saved pages</div>
      <div className="hw-grid mt-3" data-saved-web-size="yes">
        <div className="hw-tile">
          <div className="hw-label">Pages</div>
          <div className="hw-value">{status ? String(status.count) : '…'}</div>
        </div>
        <div className="hw-tile">
          <div className="hw-label">Space</div>
          <div className="hw-value">{status ? webSize(status.bytes) : '…'}</div>
        </div>
      </div>
      <button
        className="btn btn-ghost mt-3"
        type="button"
        data-clear-web="yes"
        onClick={() => { void window.surf.webCache.clear().then(setStatus).catch(() => undefined) }}
      >
        Clear saved pages
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
      <div className="text-sm font-semibold">Code projects</div>
      <div className="hw-grid mt-3" data-code-index-size="yes">
        <div className="hw-tile">
          <div className="hw-label">Projects</div>
          <div className="hw-value">{usage ? String(usage.projects.length) : '…'}</div>
        </div>
        <div className="hw-tile">
          <div className="hw-label">Space</div>
          <div className="hw-value">{usage ? formatIndexBytes(usage.totalBytes) : '…'}</div>
        </div>
      </div>
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

const ACCENT_CHOICES = ['orange', 'blue', 'indigo', 'navy'] as const
const DENSITY_CHOICES = ['compact', 'comfortable', 'relaxed'] as const

function AppearanceCard({ settings, onPatch }: { settings: Required<SettingsPatch>; onPatch: (p: SettingsPatch) => void }) {
  const [name, setName] = useState(settings.mascotName)
  useEffect(() => { setName(settings.mascotName) }, [settings.mascotName])
  return (
    <div className="card px-5 py-5" data-appearance="yes">
      <div className="mb-4 flex items-start gap-3">
        <span className="icon-tile" aria-hidden="true"><Palette size={16} /></span>
        <div>
          <div className="text-sm font-semibold">Interface</div>
          <p className="mt-1 text-sm text-[var(--muted)]">Light or dark.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Color theme">
        {(['light', 'dark'] as const).map((theme) => (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={settings.theme === theme}
            data-theme-choice={theme}
            className={`theme-card ${settings.theme === theme ? 'is-on' : ''}`}
            onClick={() => onPatch({ theme })}
          >
            <span className={`theme-preview is-${theme}`} aria-hidden="true">
              <span className="theme-preview-side" />
              <span className="theme-preview-main">
                <span className="theme-preview-bubble" />
                <span className="theme-preview-line" />
              </span>
            </span>
            <span className="mt-2 flex items-center gap-2 text-sm font-semibold">
              <Monitor size={14} />
              {theme === 'light' ? 'Light' : 'Dark'}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 text-sm font-semibold">Mascot colour</div>
      <div className="mt-2 flex flex-wrap items-center gap-2" data-mascot-colors="yes">
        {BLOB_SWATCHES.map((swatch) => (
          <button
            key={swatch.id}
            type="button"
            className={`mascot-swatch ${settings.mascotColor.toLowerCase() === swatch.hex ? 'is-on' : ''}`}
            style={{ background: swatch.hex }}
            data-mascot-color={swatch.hex}
            aria-label={swatch.label}
            aria-pressed={settings.mascotColor.toLowerCase() === swatch.hex}
            onClick={() => onPatch({ mascotColor: swatch.hex })}
          />
        ))}
        <input
          className="mascot-color-custom"
          type="color"
          aria-label="Custom mascot colour"
          data-mascot-color-custom="yes"
          value={/^#[0-9a-fA-F]{6}$/.test(settings.mascotColor) ? settings.mascotColor : '#f2740f'}
          onChange={(event) => onPatch({ mascotColor: event.target.value })}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <BlobMascot state="idle" size={64} animate={settings.animateMascot} label={name || settings.mascotName} />
        <label className="block min-w-0 flex-1 text-sm">
          <span className="font-semibold">Bot name</span>
          <input
            className="field mt-2"
            data-mascot-rename="yes"
            data-bot-name-field="yes"
            aria-label="Bot name"
            value={name}
            maxLength={BOT_NAME_LIMIT}
            onChange={(event) => setName(event.target.value)}
            onBlur={(event) => {
              const next = cleanMascotName(event.currentTarget.value)
              setName(next)
              if (next !== settings.mascotName) onPatch({ mascotName: next })
            }}
          />
        </label>
      </div>
      <div className="mt-3 text-sm font-semibold">Accent colour</div>
      <div className="mt-2 flex flex-wrap gap-2" data-accent-choices="yes">
        {ACCENT_CHOICES.map((accent) => (
          <button key={accent} type="button" className={`accent-swatch is-${accent} ${settings.accent === accent ? 'is-on' : ''}`} data-accent-choice={accent} aria-label={accent} aria-pressed={settings.accent === accent} onClick={() => onPatch({ accent })} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" data-density-choices="yes">
        {DENSITY_CHOICES.map((density) => (
          <button key={density} type="button" className="chip-tab" data-density-choice={density} aria-pressed={settings.density === density} onClick={() => onPatch({ density })}>{density}</button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">Animate Surf Bot</span>
        <button type="button" className="toggle" data-animate-mascot="yes" data-on={settings.animateMascot ? 'yes' : 'no'} aria-pressed={settings.animateMascot} onClick={() => onPatch({ animateMascot: !settings.animateMascot })}><span /></button>
      </div>
    </div>
  )
}

function MachineCard({ status }: { status: ModelStatus }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const { setBenchmark } = useMascotActivity()
  useEffect(() => {
    setBenchmark(busy !== '')
    return () => setBenchmark(false)
  }, [setBenchmark, busy])
  const chats = status.models.filter((model) => model.role === 'chat' && model.installed)
  const total = status.ramGb
  const free = typeof status.freeRamGb === 'number' ? Math.max(0, Math.min(total, status.freeRamGb)) : null
  const usedPct = free == null || total <= 0 ? 0 : ((total - free) / total) * 100
  return (
    <div className="card px-5 py-5 text-sm" data-machine="yes">
      <div className="mb-4 flex items-center gap-3">
        <span className="icon-tile is-blue" aria-hidden="true"><Cpu size={16} /></span>
        <div className="text-sm font-semibold">Hardware</div>
      </div>
      <div className="hw-grid">
        <HardwareTile icon={<Cpu size={15} />} tile="blue" label="Processor" value={cleanCpuName(status.cpuModel)} />
        <HardwareTile icon={<Hash size={15} />} tile="violet" label="Cores" value={String(status.cores)} />
        <HardwareTile
          icon={<MemoryStick size={15} />}
          tile="teal"
          label="Memory"
          value={formatRamGb(total)}
          bar={free == null ? null : (
            <div className="hw-split" aria-hidden="true">
              <b className="is-used" style={{ width: `${usedPct}%` }} />
              <b className="is-free" style={{ width: `${100 - usedPct}%` }} />
            </div>
          )}
        />
        {typeof status.contextTokens === 'number' && (
          <HardwareTile icon={<Text size={15} />} tile="" label="Memory it can read" value={formatContextTokens(status.contextTokens)} marker="context-tokens" />
        )}
        {typeof status.promptCacheMiB === 'number' && (
          <HardwareTile icon={<Database size={15} />} tile="violet" label="Chat memory" value={formatPromptCache(status.promptCacheMiB)} marker="prompt-cache" />
        )}
      </div>
      {chats.map((model) => {
        const bench = status.benchmarks?.find((row) => row.modelId === model.id && row.sizeBytes === model.sizeBytes)
        return (
          <div key={model.id} className="mt-3" data-benchmark={model.id}>
            <p>{friendlyModelName({ id: model.id, family: model.family, paramsB: model.paramsB })} · {formatIndexBytes(model.sizeBytes)}</p>
            <p data-benchmark-speed="yes">{bench ? `${bench.tokensPerSec} tok/s` : 'not measured yet'}</p>
            <button
              type="button"
              className="btn btn-ghost mt-2"
              data-run-benchmark={model.id}
              disabled={busy === model.id}
              onClick={() => {
                setBusy(model.id)
                setNote('')
                void window.surf.models.benchmark(model.id).then((result) => {
                  setNote(result.measured && result.tokensPerSec != null ? `${friendlyModelName({ id: model.id, family: model.family, paramsB: model.paramsB })}: ${result.tokensPerSec} tok/s` : `${friendlyModelName({ id: model.id, family: model.family, paramsB: model.paramsB })}: ${result.reason || 'not measured yet'}`)
                }).catch((error: unknown) => setNote((error as Error).message)).finally(() => setBusy(''))
              }}
            >Run benchmark</button>
          </div>
        )
      })}
      {note && <p className="mt-2" data-benchmark-note="yes">{note}</p>}
    </div>
  )
}

function HardwareTile({
  icon,
  tile,
  label,
  value,
  bar,
  marker,
}: {
  icon: ReactNode
  tile: '' | 'blue' | 'violet' | 'teal'
  label: string
  value: string
  bar?: ReactNode
  marker?: 'context-tokens' | 'prompt-cache'
}) {
  return (
    <div className="hw-tile" data-context-tokens={marker === 'context-tokens' ? 'yes' : undefined} data-prompt-cache={marker === 'prompt-cache' ? 'yes' : undefined}>
      <div className="flex items-center gap-2">
        <span className={`icon-tile hw-icon ${tile ? `is-${tile}` : ''}`} aria-hidden="true">{icon}</span>
        <span className="hw-label">{label}</span>
      </div>
      <div className="hw-value">{value}</div>
      {bar}
    </div>
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
