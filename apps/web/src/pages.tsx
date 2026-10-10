import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { SurfMark, ThemeSwitch, persistThemeChoice, readThemeChoice, type ThemeChoice } from '@surf/ui'
import { product } from '@surf/shared'
import { allowSubmit, contactEmail, detectClient, DRAFT, footerLinks, formKey, formRoles, pickDownload } from './site'

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
        <SurfMark size={40} />
        <span className="text-[15px] font-semibold">Surf AI</span>
      </a>
      <nav className="hidden items-center gap-4 text-sm md:flex">
        <a className="text-[var(--muted)] no-underline" href="/#how">How it works</a>
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
        <span>Surf AI · on your computer</span>
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
        Surf AI is designed so chats and documents stay on your device in an encrypted database. The model runs locally. This page is a description of that design. It is not a certification, and it does not mean data cannot be leaked. A stolen computer, a bug, or other software on the machine can still expose files.
      </p>
      <p>
        Designed around the India IT Act 2000 and the DPDP Act 2023, the EU and UK GDPR, and the California CCPA/CPRA. Naming those laws is not a claim of certified compliance.
      </p>
      <ul className="list-disc space-y-2 pl-5">
        <li>The app reads only the folders and files you pick. It does not edit, move, or delete those files on its own.</li>
        <li>Sending, changing, or deleting mail waits for your approval. Delete asks a second time.</li>
        <li>Web search is optional. When you allow it, only the short query is sent, not your documents.</li>
        <li>There are no ads and no sale of data. Crash reports are off by default.</li>
        <li>To delete everything Surf stored, quit the app and remove its data folder: ~/Library/Application Support/surf-ai on macOS, or %APPDATA%\surf-ai on Windows.</li>
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

export function DownloadCard() {
  const clientGuess = detectClient({ ua: typeof navigator === 'undefined' ? '' : navigator.userAgent })
  const [links, setLinks] = useState<{ mac: string; win: string; guess: string }>({ mac: product.releasesUrl, win: product.releasesUrl, guess: clientGuess.os === 'mac' ? `mac-${clientGuess.arch}` : clientGuess.os })

  useEffect(() => {
    let gone = false
    async function load() {
      const nav = navigator as Navigator & { userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> } }
      let architecture: string | undefined
      try { architecture = (await nav.userAgentData?.getHighEntropyValues?.(['architecture']))?.architecture } catch { /* the UA string is enough */ }
      const client = detectClient({ ua: navigator.userAgent, architecture })
      const guess = client.os === 'mac' ? `mac-${client.arch}` : client.os
      let mac: string = product.releasesUrl
      let win: string = product.releasesUrl
      try {
        const response = await fetch('https://api.github.com/repos/kslji/synap.ai/releases/latest', {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SurfAI' },
        })
        if (response.ok) {
          const body = await response.json() as { assets?: Array<{ name?: string; browser_download_url?: string }> }
          const assets = (body.assets ?? [])
            .filter((asset) => asset.name && asset.browser_download_url)
            .map((asset) => ({ name: asset.name as string, url: asset.browser_download_url as string }))
          mac = pickDownload(assets, 'mac', client.os === 'mac' ? client.arch : 'arm64')?.url ?? mac
          win = pickDownload(assets, 'windows', 'x64')?.url ?? win
        }
      } catch { /* the Releases page is the fallback */ }
      if (!gone) setLinks({ mac, win, guess })
    }
    void load()
    return () => { gone = true }
  }, [])

  return (
    <div className="mt-5 flex flex-col gap-2 md:mt-0" data-download-page="yes" data-download-guess={links.guess}>
      <a className="btn btn-primary no-underline" data-download="mac" data-suggested={links.guess.startsWith('mac') ? 'yes' : 'no'} href={links.mac}>
        macOS .dmg{links.guess.startsWith('mac') ? ' · this computer' : ''}
      </a>
      <a className="btn btn-ghost no-underline" data-download="windows" data-suggested={links.guess === 'windows' ? 'yes' : 'no'} href={links.win}>
        Windows .exe{links.guess === 'windows' ? ' · this computer' : ''}
      </a>
      <p className="max-w-xs text-xs leading-relaxed text-[var(--muted)]">
        Apple silicon and Intel get separate disk images, so you do not download both. Until a release is published, the buttons open the Releases page.
      </p>
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
      window.location.href = `mailto:${email}?subject=${encodeURIComponent('Surf AI — ' + role)}&body=${encodeURIComponent(`${name} <${from}>\n${url}\n\n${message}`)}`
      return
    }
    sessionStorage.setItem('surf-form-at', String(Date.now()))
    const response = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: key,
        subject: `Surf AI contribute — ${role}`,
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
