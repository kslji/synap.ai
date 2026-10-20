import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Cpu } from 'lucide-react'
import { BlobMascot, ThemeSwitch, persistThemeChoice, readThemeChoice, type ThemeChoice } from '@surf/ui'
import { product } from '@surf/shared'
import { beginDownload, DownloadButtons } from './download-buttons'
import { allowSubmit, ALL_DOWNLOADS_URL, BUNDLED_ASSETS, contactEmail, detectClient, downloadHrefs, DRAFT, footerLinks, formKey, formRoles, newestPublishableRelease, offlineCatalogUrl, offlineSizeLabel, parseOfflinePackages, pickOfflinePackage, releaseAssets, SEARCH_MODEL_BYTES, SETUP_MODELS, smallInstallerHref, type OfflinePackage, type ReleaseListItem } from './site'

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice())
  function choose(next: ThemeChoice) {
    setTheme(next)
    persistThemeChoice(next)
  }
  return [theme, choose]
}

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/#agents', label: 'Agents' },
  { href: '/about#pip', label: 'Pip' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const

export function SiteHeader({ theme, onTheme }: { theme: ThemeChoice; onTheme: (next: ThemeChoice) => void }) {
  const [menu, setMenu] = useState(false)
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href="/" className="flex items-center gap-2 text-[var(--ink)] no-underline">
          <BlobMascot state="idle" size={40} label="Pip" />
          <span className="text-[15px] font-semibold">{product.name}</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          {NAV.map((item) => (
            <a key={item.href} href={item.href}>{item.label}</a>
          ))}
          <ThemeSwitch value={theme} onChange={onTheme} />
          <a className="btn btn-primary no-underline" href="/#download">Download</a>
        </nav>
        <div className="menu-button flex items-center gap-2">
          <ThemeSwitch value={theme} onChange={onTheme} compact />
          <button type="button" className="btn btn-ghost" aria-expanded={menu} aria-controls="site-menu" data-menu-button="site" onClick={() => setMenu((v) => !v)}>Menu</button>
        </div>
      </div>
      {menu && (
        <div id="site-menu" className="site-menu">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setMenu(false)}>{item.label}</a>
          ))}
          <a href="/#download" onClick={() => setMenu(false)}>Download</a>
          <a href="/privacy" onClick={() => setMenu(false)}>Privacy</a>
          <a href="/security" onClick={() => setMenu(false)}>Security</a>
          <a href="/contribute" onClick={() => setMenu(false)}>Contribute</a>
        </div>
      )}
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] px-6 py-10">
      <div className="mx-auto grid max-w-6xl gap-8 text-sm text-[var(--muted)] md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2 text-[var(--ink)]">
            <BlobMascot state="idle" size={36} variant="mark" label="Pip" />
            <span className="font-semibold">{product.name}</span>
          </div>
          <p className="mt-3 max-w-xs leading-relaxed">{product.tagline}</p>
        </div>
        <nav className="flex flex-col gap-2" aria-label="Product">
          <a href="/features">Features</a>
          <a href="/#agents">Agents</a>
          <a href="/pricing">Pricing</a>
          <a href="/docs">Docs</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
        </nav>
        <nav className="flex flex-col gap-2" aria-label="Legal">
          {footerLinks.map((link) => (
            <a key={link.href} className="text-[var(--muted)]" href={link.href}>{link.label}</a>
          ))}
        </nav>
      </div>
    </footer>
  )
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  const [theme, onTheme] = useTheme()
  return (
    <div>
      <SiteHeader theme={theme} onTheme={onTheme} />
      <main className="mx-auto max-w-3xl px-6 pb-16">
        <p className="pill">{DRAFT}</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-[var(--muted)]">{children}</div>
      </main>
      <SiteFooter />
    </div>
  )
}

export function PrivacyPage() {
  const email = contactEmail()
  const [theme, onTheme] = useTheme()
  return (
    <div data-page="privacy">
      <SiteHeader theme={theme} onTheme={onTheme} />
      <main id="top" className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-8 md:grid-cols-[220px_1fr]">
        <nav className="flex flex-col gap-2 text-sm" aria-label="On this page">
          <a href="#design">Design</a>
          <a href="#laws">Laws named here</a>
          <a href="#files">Your files</a>
          <a href="#mail">Mail</a>
          <a href="#search">Web search</a>
          <a href="#ads">Ads and crash reports</a>
          <a href="#delete">Delete</a>
          <a href="/terms">Terms</a>
          <a href="/security">Security</a>
        </nav>
        <div>
          <p className="pill">{DRAFT}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">Privacy</h1>
          <div className="mt-6 flex flex-col gap-4 text-[15px] leading-relaxed text-[var(--muted)]">
            <p className="card px-5 py-5" id="design">
              Synap.surf is designed so chats and documents stay on your device in an encrypted database. The model runs locally. This page is a description of that design. It is not a certification, and it does not mean data cannot be leaked. A stolen computer, a bug, or other software on the machine can still expose files.
            </p>
            <p className="card px-5 py-5" id="laws">
              Designed around the India IT Act 2000 and the DPDP Act 2023, the EU and UK GDPR, and the California CCPA/CPRA. Naming those laws is not a claim of certified compliance.
            </p>
            <ul className="flex flex-col gap-3">
              <li className="card px-5 py-4" id="files">The app reads only the folders and files you pick. It does not edit, move, or delete those files on its own.</li>
              <li className="card px-5 py-4" id="mail">Sending, changing, or deleting mail waits for your approval. Delete asks a second time.</li>
              <li className="card px-5 py-4" id="search">Web search is optional. When you allow it, only the short query is sent, not your documents.</li>
              <li className="card px-5 py-4" id="ads">There are no ads and no sale of data. Crash reports are off by default.</li>
              <li className="card px-5 py-4" id="delete">To delete everything the app stored, quit Synap.surf and remove its data folder: ~/Library/Application Support/surf-ai on macOS, or %APPDATA%\surf-ai on Windows.</li>
            </ul>
            <p>Questions: <a href={`mailto:${email}`}>{email}</a></p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

export function SecurityPage() {
  const email = contactEmail()
  return (
    <Page title="Security">
      <p data-page="security">
        These are the controls in the app. They are not a certification, and they are not a promise that data cannot be leaked.
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>The local database uses SQLCipher. Connector tokens use the operating system keychain when that is available.</li>
        <li>Writes and deletes go through an approval gate in the main process. Delete asks twice.</li>
        <li>Text from documents and the web is untrusted data. A sanitizer drops instructions that ride along inside it.</li>
        <li>Knowledge packs are signed with Ed25519 and checked by hash before they install.</li>
        <li>Code preview and the script sandbox do not get the network.</li>
        <li>Telemetry is off by default. Logs stay on the computer.</li>
        <li>The source is public: <a href={product.repo}>GitHub</a>.</li>
      </ul>
      <p>
        To report a problem, email <a href={`mailto:${email}`}>{email}</a> with the version, the operating system, and the steps. Please give the maintainers a chance to fix it before posting the details in public.
      </p>
    </Page>
  )
}

export function BuyPage() {
  const email = contactEmail()
  return (
    <Page title="Buy a licence">
      <p data-page="buy">
        The Mac and Windows installers can be shared. Synap.surf stays on the activation screen until this computer has a licence. Sign in with the account that bought it, or enter the key from the receipt.
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>A licence covers a set number of computers. The usual limit is two. You can remove a computer from the account when you stop using it.</li>
        <li>Plans run for 1, 3, 6, or 12 months. When that date passes, the app locks on that computer, including offline. Renewing extends the same licence.</li>
        <li>The app keeps a signed licence file on that computer and checks it without calling home. It refreshes the file when a connection is available.</li>
        <li>Checkout on this page is not open yet. Card payment will create the key through the same account email.</li>
      </ul>
      <p>To ask about a licence, email <a href={`mailto:${email}`}>{email}</a>.</p>
    </Page>
  )
}

export function TermsPage() {
  return (
    <Page title="Terms">
      <p data-page="terms">
        Draft — not legal advice. Synap.surf is a beta. It is provided as-is, without a warranty. Do not use it for high-frequency trading, and do not use it to send spam or cold email.
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>You keep the files on your computer. The project does not take ownership of them.</li>
        <li>Unsigned beta builds can be blocked by macOS or Windows until you allow them once.</li>
        <li>Do not use the app to break the law or to attack other people’s systems.</li>
      </ul>
    </Page>
  )
}

function webglRenderer(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return ''
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '')
  } catch {
    return ''
  }
}

export const MAC_STEPS = [
  'Open the disk image when it finishes.',
  'Drag Synap.surf into Applications.',
  'Open Synap.surf. If macOS blocks it, go to System Settings, then Privacy & Security, scroll to Security, and click Open Anyway. You only do this once.',
  'Click Download. Leave that screen up until Qwen and the search model finish.',
]

export const WINDOWS_STEPS = [
  'Open the installer when it finishes.',
  'If SmartScreen says Windows protected your PC, click More info, then Run anyway.',
  'Finish the prompts. You only do this once.',
  'Click Download. Leave that screen up until Qwen and the search model finish.',
]

export const MAC_OFFLINE_STEPS = [
  'Open the zip when it finishes.',
  'Open Synap.surf. If macOS blocks it, go to System Settings, then Privacy & Security, scroll to Security, and click Open Anyway. You only do this once.',
  'Chat opens. The model is already in the app, so nothing downloads.',
]

export const WINDOWS_OFFLINE_STEPS = [
  'Extract the zip when it finishes.',
  'Open SynapSurf.exe. If SmartScreen says Windows protected your PC, click More info, then Run anyway.',
  'Chat opens. The model is already in the app, so nothing downloads.',
]

export function DownloadCard() {
  const initial = detectClient({ ua: typeof navigator === 'undefined' ? '' : navigator.userAgent })
  const [os, setOs] = useState(initial.os)
  const [arch, setArch] = useState<'arm64' | 'x64'>(initial.os === 'mac' ? initial.arch : 'arm64')
  const [assetPool, setAssetPool] = useState(BUNDLED_ASSETS)
  const [offlinePackages, setOfflinePackages] = useState<OfflinePackage[]>([])
  const [started, setStarted] = useState<null | { os: 'mac' | 'windows'; offline: boolean }>(null)

  useEffect(() => {
    let gone = false
    async function load() {
      const nav = navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> } }
      let architecture: string | undefined
      try { architecture = (await nav.userAgentData?.getHighEntropyValues?.(['architecture']))?.architecture } catch { /* baked URLs still work */ }
      const client = detectClient({ ua: navigator.userAgent, architecture, renderer: webglRenderer() })
      let assets = BUNDLED_ASSETS
      try {
        const response = await fetch('https://api.github.com/repos/kslji/synap.ai/releases?per_page=5', {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Synap.surf' },
        })
        if (response.ok) {
          const body = await response.json() as ReleaseListItem[]
          const live = releaseAssets(newestPublishableRelease(Array.isArray(body) ? body : []))
          if (live.some((asset) => asset.name.endsWith('.dmg') || asset.name.endsWith('.exe'))) assets = live
        }
      } catch { /* the baked installer URLs stay in the buttons */ }
      let packages: OfflinePackage[] = []
      const catalog = offlineCatalogUrl(assets)
      if (catalog) {
        try {
          const response = await fetch(catalog)
          if (response.ok) packages = parseOfflinePackages(await response.json())
        } catch { /* the row still shows the model bytes */ }
      }
      if (gone) return
      setOs(client.os)
      setArch(client.os === 'mac' ? client.arch : 'arm64')
      setAssetPool(assets)
      setOfflinePackages(packages)
    }
    void load()
    return () => { gone = true }
  }, [])

  const hrefs = downloadHrefs(assetPool, 'mac', 'arm64')
  const intel = os === 'mac' && arch === 'x64'
  const macSuggested = os !== 'windows' && !intel
  const winSuggested = os === 'windows'

  return (
    <div className="mt-5 flex flex-col gap-3 md:mt-0" data-download-page="yes" data-download-guess={os === 'mac' ? `mac-${arch}` : os}>
      <p className="text-sm leading-relaxed text-[var(--muted)]">One installer. After you install, the app downloads one Qwen model that works on any laptop with 8 GB of memory or more.</p>
      <div className="flex flex-wrap gap-2">
        <DownloadButtons
          mac={hrefs.mac}
          win={hrefs.win}
          macLabel="Download for Mac"
          winLabel="Download for Windows"
          macSuggested={macSuggested}
          winSuggested={winSuggested}
          onStart={(next) => setStarted({ os: next, offline: false })}
        />
        <a
          className={intel ? 'btn btn-primary no-underline' : 'btn btn-ghost no-underline'}
          href={hrefs.intel}
          data-download-intel="yes"
          onClick={(event) => beginDownload(event, 'mac', (next) => setStarted({ os: next, offline: false }))}
        >
          Download for Intel Mac
        </a>
      </div>
      <div data-model-list="yes">
        <p className="text-sm font-semibold">Model</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">The model is the Qwen file plus a 309.9 MB search model. Download is the small installer, and the model downloads on first open. Offline installer is one zip that already includes both files.</p>
        <ul className="mt-3 flex flex-col gap-2">
          {SETUP_MODELS.map((model) => {
            const clientOs = os === 'windows' ? 'windows' : 'mac'
            const clientArch = os === 'windows' ? 'x64' : arch
            const smallHref = smallInstallerHref(hrefs, clientOs, clientArch)
            const offline = offlineSizeLabel(pickOfflinePackage(offlinePackages, clientOs, clientArch, model.token), model.sizeBytes + SEARCH_MODEL_BYTES)
            return (
              <li key={model.id} className="model-choice" data-setup-model={model.id}>
                <span className="icon-tile" aria-hidden="true"><Cpu size={16} /></span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">{model.name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">
                    <span data-model-size={model.id}>{model.size}</span>
                    {' · '}
                    <span data-model-ram={model.id}>needs {model.ramGb} GB RAM</span>
                    <span className="mt-0.5 block" data-model-parts={model.id}>{model.parts}</span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <a className="btn btn-ghost no-underline" href={smallHref} data-download-size={model.id} onClick={(event) => beginDownload(event, clientOs, (next) => setStarted({ os: next, offline: false }))}>Download</a>
                    {offline.href ? (
                      <a className="btn btn-ghost no-underline" href={offline.href} data-offline={model.token} data-offline-size={model.token} onClick={(event) => beginDownload(event, clientOs, (next) => setStarted({ os: next, offline: true }))}>
                        Offline installer · {offline.bytesLabel}
                      </a>
                    ) : (
                      <span data-offline={model.token} data-offline-size={model.token}>Offline installer · {offline.bytesLabel}</span>
                    )}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <a className="self-start text-xs text-[var(--muted)]" href={ALL_DOWNLOADS_URL}>All downloads</a>
      {started && (
        <div className="card mt-2 px-4 py-4" data-download-started={started.os} data-offline-start={started.offline ? 'yes' : 'no'}>
          <BlobMascot state="guiding" size={72} label="Pip" />
          <p className="mt-2 text-sm font-semibold">Your download has started</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[var(--muted)]">
            {(started.offline
              ? (started.os === 'mac' ? MAC_OFFLINE_STEPS : WINDOWS_OFFLINE_STEPS)
              : (started.os === 'mac' ? MAC_STEPS : WINDOWS_STEPS)).map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      )}
    </div>
  )
}

export function ContributePage() {
  const email = contactEmail()
  const key = formKey()
  const [notice, setNotice] = useState('')
  const [honeypot, setHoneypot] = useState('')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (honeypot) {
      setNotice('Thanks. Your note is on its way.')
      return
    }
    const last = Number(sessionStorage.getItem('surf-form-at') || '0')
    if (!allowSubmit(Date.now(), last || null)) {
      setNotice('Please wait a moment, then try again.')
      return
    }
    const data = new FormData(event.currentTarget)
    const name = String(data.get('name') || '')
    const from = String(data.get('email') || '')
    const role = String(data.get('role') || '')
    const url = String(data.get('url') || '')
    const message = String(data.get('message') || '')
    if (!key) {
      window.location.href = `mailto:${email}?subject=${encodeURIComponent('Synap.surf — ' + role)}&body=${encodeURIComponent(`${name} <${from}>\n${url}\n\n${message}`)}`
      return
    }
    sessionStorage.setItem('surf-form-at', String(Date.now()))
    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: key,
        subject: `Synap.surf contribute — ${role}`,
        name,
        email: from,
        role,
        url,
        message,
        botcheck: honeypot,
      }),
    })
    setNotice(response.ok ? 'Thanks. Your note is on its way.' : 'The form did not send. Use the email link below.')
  }

  return (
    <Page title="Contribute">
      <p data-page="contribute">
        Tell us how you would like to help. The form is sent by Web3Forms to {email}. This website does not store the message. A hidden field and a short wait between submits block obvious spam.
      </p>
      <form className="card flex flex-col gap-3 px-5 py-5" data-contribute-form="yes" onSubmit={(event) => { void onSubmit(event) }}>
        <label className="text-sm">Name
          <input className="field mt-1" name="name" required autoComplete="name" />
        </label>
        <label className="text-sm">Email
          <input className="field mt-1" name="email" type="email" required autoComplete="email" />
        </label>
        <label className="text-sm">Role
          <select className="field mt-1" name="role" defaultValue="code">
            {formRoles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        <label className="text-sm">GitHub or portfolio URL
          <input className="field mt-1" name="url" type="url" placeholder="https://" />
        </label>
        <label className="text-sm">Message
          <textarea className="field mt-1 min-h-28" name="message" required />
        </label>
        <label className="absolute -left-[9999px]" aria-hidden="true">Company
          <input name="company" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit">Send</button>
        {notice && <p className="text-sm">{notice}</p>}
      </form>
      <p>Or write directly: <a href={`mailto:${email}`}>{email}</a></p>
    </Page>
  )
}
