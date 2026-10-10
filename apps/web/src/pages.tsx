import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { StarSurf, ThemeSwitch, persistThemeChoice, readThemeChoice, type ThemeChoice } from '@surf/ui'
import { product } from '@surf/shared'
import { DownloadButtons } from './download-buttons'
import { allowSubmit, ALL_DOWNLOADS_URL, BUNDLED_ASSETS, contactEmail, detectClient, downloadHrefs, DRAFT, footerLinks, formKey, formRoles, newestPublishableRelease, releaseAssets, type ReleaseListItem } from './site'

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(() => readThemeChoice())
  function choose(next: ThemeChoice) {
    setTheme(next)
    persistThemeChoice(next)
  }
  return [theme, choose]
}

export function SiteHeader({ theme, onTheme }: { theme: ThemeChoice; onTheme: (next: ThemeChoice) => void }) {
  const [menu, setMenu] = useState(false)
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-6 py-5">
      <a href="/" className="flex items-center gap-2 text-[var(--ink)] no-underline">
        <StarSurf state="idle" size={40} />
        <span className="text-[15px] font-semibold">{product.name}</span>
      </a>
      <nav className="hidden items-center gap-4 text-sm md:flex">
          <a className="text-[var(--muted)] no-underline" href="/#companion">Companion</a>
        <a className="text-[var(--muted)] no-underline" href="/#agents">Agents</a>
        <a className="text-[var(--muted)] no-underline" href="/#download">Download</a>
        <a className="text-[var(--muted)] no-underline" href="/privacy">Privacy</a>
        <ThemeSwitch value={theme} onChange={onTheme} />
      </nav>
      <div className="flex items-center gap-2 md:hidden">
        <ThemeSwitch value={theme} onChange={onTheme} compact />
        <button type="button" className="btn btn-ghost" aria-expanded={menu} data-menu-button="site" onClick={() => setMenu((v) => !v)}>Menu</button>
      </div>
      {menu && (
        <div className="absolute left-0 right-0 top-16 flex flex-col gap-3 bg-[var(--bg)] px-6 py-4 md:hidden">
          <a className="no-underline" href="/#download" onClick={() => setMenu(false)}>Download</a>
          <a className="no-underline" href="/privacy" onClick={() => setMenu(false)}>Privacy</a>
          <a className="no-underline" href="/security" onClick={() => setMenu(false)}>Security</a>
          <a className="no-underline" href="/contribute" onClick={() => setMenu(false)}>Contribute</a>
        </div>
      )}
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--line)] px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]">
        <span>{product.name} · on your computer</span>
        <nav className="flex flex-wrap gap-4">
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
  return (
    <Page title="Privacy">
      <p data-page="privacy">
        Synap.surf is designed so chats and documents stay on your device in an encrypted database. The model runs locally. This page is a description of that design. It is not a certification, and it does not mean data cannot be leaked. A stolen computer, a bug, or other software on the machine can still expose files.
      </p>
      <p>
        Designed around the India IT Act 2000 and the DPDP Act 2023, the EU and UK GDPR, and the California CCPA/CPRA. Naming those laws is not a claim of certified compliance.
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>The app reads only the folders and files you pick. It does not edit, move, or delete those files on its own.</li>
        <li>Sending, changing, or deleting mail waits for your approval. Delete asks a second time.</li>
        <li>Web search is optional. When you allow it, only the short query is sent, not your documents.</li>
        <li>There are no ads and no sale of data. Crash reports are off by default.</li>
        <li>To delete everything the app stored, quit Synap.surf and remove its data folder: ~/Library/Application Support/surf-ai on macOS, or %APPDATA%\surf-ai on Windows.</li>
      </ul>
      <p>Questions: <a href={`mailto:${email}`}>{email}</a></p>
    </Page>
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

const MAC_STEPS = [
  'Open the disk image when it finishes.',
  'Drag Synap.surf into Applications.',
  'If macOS blocks the app, choose Open Anyway in Privacy & Security. You only do this once.',
]

const WINDOWS_STEPS = [
  'Open the installer when it finishes.',
  'If Windows asks, choose More info, then Run anyway.',
  'Finish the prompts. You only do this once.',
]

export function DownloadCard() {
  const initial = detectClient({ ua: typeof navigator === 'undefined' ? '' : navigator.userAgent })
  const initialArch = initial.os === 'mac' ? initial.arch : 'arm64'
  const baked = downloadHrefs(BUNDLED_ASSETS, initial.os, initialArch)
  const [os, setOs] = useState(initial.os)
  const [arch, setArch] = useState(initialArch)
  const [links, setLinks] = useState(baked)
  const [started, setStarted] = useState<'mac' | 'windows' | null>(null)
  const preferIntel = useRef(false)

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
      if (gone) return
      const nextArch = preferIntel.current ? 'x64' : client.os === 'mac' ? client.arch : 'arm64'
      setOs(client.os)
      setArch(nextArch)
      setLinks(downloadHrefs(assets, client.os, nextArch))
    }
    void load()
    return () => { gone = true }
  }, [])

  const macHref = arch === 'x64' ? links.intel : links.mac
  const macHere = os === 'mac' && arch !== 'x64'
  const winHere = os === 'windows'

  return (
    <div className="mt-5 flex flex-col gap-2 md:mt-0" data-download-page="yes" data-download-guess={os === 'mac' ? `mac-${arch}` : os}>
      <DownloadButtons
        mac={macHref}
        win={links.win}
        macLabel={`Download for Mac${macHere ? ' · this computer' : arch === 'x64' ? ' · Intel' : ''}`}
        winLabel={`Download for Windows${winHere ? ' · this computer' : ''}`}
        macSuggested={macHere}
        winSuggested={winHere}
        onStart={setStarted}
      />
      <button type="button" className="self-start text-xs text-[var(--muted)] underline" data-download-intel="yes" onClick={() => { preferIntel.current = true; setArch('x64') }}>
        Intel Mac?
      </button>
      <a className="self-start text-xs text-[var(--muted)]" href={ALL_DOWNLOADS_URL}>All downloads</a>
      {started && (
        <div className="card mt-2 px-4 py-4" data-download-started={started}>
          <StarSurf state="guiding" size={72} />
          <p className="mt-2 text-sm font-semibold">Your download has started</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-[var(--muted)]">
            {(started === 'mac' ? MAC_STEPS : WINDOWS_STEPS).map((step) => <li key={step}>{step}</li>)}
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
