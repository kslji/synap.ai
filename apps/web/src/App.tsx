import { SurfCrew } from '@surf/ui'
import { embeddingModel, modelTiers, product } from '@surf/shared'
import { BETA_UNSIGNED } from './beta'
import { ContributePage, DownloadCard, PrivacyPage, SecurityPage, SiteFooter, SiteHeader, useTheme } from './pages'

const FEATURES = [
  {
    title: 'Offline AI on your laptop',
    body: 'Qwen3.5 runs on the machine in front of you. The first launch picks 2B, 4B, or 9B from the memory you actually have.',
  },
  {
    title: 'Private by default',
    body: 'Chats and documents stay in an encrypted database on the device. Telemetry is off until you opt in. There is no local API server.',
  },
  {
    title: 'Answers with sources',
    body: 'Surf looks up what you have saved, checks that it is relevant, and cites it. If the sources are thin, it says so instead of guessing.',
  },
  {
    title: 'Niche experts, later',
    body: 'General is ready to chat. Marine, construction, and aviation agents arrive as signed knowledge packs, the same app underneath.',
  },
]

const STEPS = [
  { n: '01', title: 'Download', body: 'One installer for macOS or Windows. No terminal, no Python, no model hunt.' },
  { n: '02', title: 'First launch', body: 'Surf checks your RAM and downloads the matching model, with progress you can resume.' },
  { n: '03', title: 'Chat offline', body: 'Pull the network cable. The conversation, the calculator, and your files still work.' },
]

const FAQ = [
  {
    q: 'Does Surf need the internet?',
    a: 'No. Chat, the calculator, and anything already downloaded work offline. When you are online, and only if you allow it, Surf can later search the web and refresh packs.',
  },
  {
    q: 'Where do my chats go?',
    a: 'They stay on your computer in an encrypted SQLite file. The key is wrapped by the Mac keychain or Windows DPAPI. Surf does not send prompts to a cloud model.',
  },
  {
    q: 'Which models?',
    a: `Chat is Qwen3.5 in the unsloth Q4_K_M build: 2B under 8 GB, 4B at 8 GB, 9B at 16 GB and above. Embeddings are ${embeddingModel.name}, ${embeddingModel.detail.toLowerCase()}.`,
  },
  {
    q: 'What does it cost?',
    a: 'The app and the models are free and open-source. Installers are published on GitHub Releases. There is no subscription in this build.',
  },
]

const BETA_FAQ = {
  q: 'Beta: opening on Mac',
  a: 'Mac users: during the beta, Surf AI isn’t signed by Apple yet, so macOS may say it can’t be opened or is from an unidentified developer. Open Surf AI once so macOS blocks it, then go to System Settings → Privacy & Security, scroll to Security, and click Open Anyway next to Surf AI. You only need to do this once. Windows users: if you see “Windows protected your PC”, click the small underlined More info link under the warning. The window then shows the app name and Unknown publisher, with a Run anyway button at the bottom right. Click Run anyway to install. You only need to do this once.',
}

export function BetaUnsignedNote() {
  return (
    <aside className="mt-6 border-t border-[var(--line)] pt-6" data-beta-unsigned="yes">
      <p className="pill">Beta: opening on Mac</p>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed">
        Mac users: during the beta, Surf AI isn&apos;t signed by Apple yet, so macOS may say it can&apos;t be opened or is from an unidentified developer. You only need to do this once.
      </p>
      <ol className="mt-3 max-w-3xl list-decimal space-y-1 pl-5 text-sm leading-relaxed">
        <li>Open Surf AI once so macOS blocks it.</li>
        <li>Go to System Settings → Privacy &amp; Security.</li>
        <li>Scroll to the Security section.</li>
        <li>Click Open Anyway next to Surf AI, then confirm.</li>
      </ol>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">
        Windows users: if you see &quot;Windows protected your PC&quot;, click the small underlined More info link under the warning. The window then shows the app name and Unknown publisher, with a Run anyway button at the bottom right. Click Run anyway to install. You only need to do this once.
      </p>
    </aside>
  )
}

export function App() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  if (path === '/privacy') return <PrivacyPage />
  if (path === '/security') return <SecurityPage />
  if (path === '/contribute') return <ContributePage />
  return <Home />
}

function Home() {
  const [theme, onTheme] = useTheme()

  return (
    <div>
      <SiteHeader theme={theme} onTheme={onTheme} />

      <main id="top">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-8 md:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="pill">Local-first desktop</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              A calm assistant that lives on your laptop.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">{product.tagline}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a className="btn btn-primary no-underline" href="#download">Download Surf AI</a>
              <a className="btn btn-ghost no-underline" href="#how">See the three steps</a>
            </div>
          </div>
          <div className="card flex flex-col items-center px-6 py-10">
            <SurfCrew mood="idle" size={320} />
            <p className="mt-4 text-center text-sm text-[var(--muted)]">A jellyfish, a seahorse, and an octopus. Nothing sent away.</p>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 md:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.title} className="card px-6 py-6">
              <h2 className="text-xl font-semibold tracking-tight">{f.title}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted)]">{f.body}</p>
            </article>
          ))}
        </section>

        <section id="how" className="mx-auto max-w-6xl px-6 pb-16">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((s) => (
              <article key={s.n} className="rounded-3xl bg-[var(--bg-side)] px-5 py-5">
                <div className="text-sm font-semibold text-[var(--accent-text)]">{s.n}</div>
                <h3 className="mt-2 text-xl font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{s.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="download" className="mx-auto max-w-6xl px-6 pb-16">
          <div className="card px-8 py-8">
            <div className="md:flex md:items-center md:justify-between">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">Download</h2>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--muted)]">
                  macOS gets a .dmg. Windows gets an .exe. On first launch the app checks this computer&apos;s memory and downloads the matching model.
                  Installers are published on GitHub Releases. Until the first tagged release, these buttons open the Releases page.
                </p>
              </div>
              <DownloadCard />
            </div>
            {BETA_UNSIGNED && <BetaUnsignedNote />}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-16">
          <h2 className="text-3xl font-semibold tracking-tight">System requirements</h2>
          <div className="card mt-4 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--bg-side)] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Memory</th>
                  <th className="px-4 py-3 font-semibold">Chat model</th>
                  <th className="px-4 py-3 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {modelTiers.map((t) => (
                  <tr key={t.ram} className="border-t border-[var(--line)]">
                    <td className="px-4 py-3">{t.ram}</td>
                    <td className="px-4 py-3">{t.chat} {t.quant}</td>
                    <td className="px-4 py-3 text-[var(--muted)]">{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-[var(--muted)]">
            macOS 12 or newer (Apple silicon and Intel) and Windows 10 or 11, 64-bit. A GPU is optional. Leave a few extra gigabytes free for the model file.
          </p>
        </section>

        <section id="faq" className="mx-auto max-w-3xl px-6 pb-20">
          <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-4 flex flex-col gap-2">
            {(BETA_UNSIGNED ? [...FAQ, BETA_FAQ] : FAQ).map((item) => (
              <details key={item.q} className="card px-5 py-4" open={item.q.startsWith('Beta')}>
                <summary className="cursor-pointer text-[15px] font-semibold">{item.q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  )
}
