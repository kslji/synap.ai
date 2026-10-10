import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { StarSurf } from '@surf/ui'
import { embeddingModel, modelTiers, product } from '@surf/shared'
import { agents } from '../../../packages/shared/src/agent-catalog'
import { AgentCards } from './AgentCards'
import { BETA_UNSIGNED } from './beta'
import { BetaUnsignedNote } from './beta-note'
import { DownloadCard, SiteFooter, SiteHeader, useTheme } from './pages'
import './landing.css'

function useReveal(): RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('is-in')
      return
    }
    const watcher = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add('is-in')
      }
    }, { threshold: 0.18 })
    watcher.observe(el)
    return () => watcher.disconnect()
  }, [])
  return ref
}

function Block({ id, children }: { id?: string; children: ReactNode }) {
  const ref = useReveal()
  return (
    <section id={id} ref={ref} className="reveal mx-auto max-w-6xl px-6 pb-20">
      {children}
    </section>
  )
}

const FAQ = [
  {
    q: 'Which computers can run it?',
    a: 'macOS 12 or newer, Apple silicon and Intel, and Windows 10 or 11, 64-bit. A GPU is optional. Leave a few extra gigabytes free for the model file.',
  },
  {
    q: 'How is this different from ChatGPT or Claude?',
    a: 'Those assistants answer from a service on the internet. Synap.surf runs the chat model on your machine. After the first download, the conversation still works with the network unplugged.',
  },
  {
    q: 'Is it free?',
    a: 'Yes. This beta, the installers, and the models we point at are free. There is no subscription in this build.',
  },
  {
    q: 'What data leaves the device?',
    a: 'Chats and documents stay in an encrypted database on the computer. Telemetry is off unless you opt in. A web search, a pack update, or a contribute form only runs when you are online and you have allowed that step. We do not sell data.',
  },
  {
    q: 'What hardware does the model need?',
    a: `Under 8 GB of memory uses ${modelTiers[0].chat}. 8 GB uses ${modelTiers[1].chat}. 16 GB and above uses ${modelTiers[2].chat}. Embeddings are ${embeddingModel.name}.`,
  },
]

export function Landing() {
  const [theme, onTheme] = useTheme()
  return (
    <div>
      <SiteHeader theme={theme} onTheme={onTheme} />
      <main id="top">
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-20 pt-6 md:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="pill">On your computer</p>
            <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-tight md:text-6xl">
              Meet Star Surf, your offline companion.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
              {product.tagline} Chat, your files, and the calculator stay here. The network is optional.
            </p>
            <div className="mt-8">
              <DownloadCard />
            </div>
          </div>
          <div className="flex flex-col items-center">
            <StarSurf state="arrive" size={280} followCursor label="Star Surf, your offline companion" />
          </div>
        </section>

        <Block id="companion">
          <h2 className="text-3xl font-semibold tracking-tight">Meet your companion</h2>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">Star Surf stays in motion. The pose tells you what the app is doing.</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Vignette state="searching" title="Searching" body="Web lookup, file search, indexing, and a reply being written." />
            <Vignette state="guiding" title="Guiding" body="First launch and model setup, pointing at the next step instead of a manual." />
            <Vignette state="notification" title="A small wave" body="A pack finished updating, or a new installer is ready. Nothing shouts." />
          </div>
        </Block>

        <Block id="offline">
          <h2 className="text-3xl font-semibold tracking-tight">Works with no internet</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <article className="card px-6 py-6">
              <h3 className="text-xl font-semibold">Already on the machine</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                Offline chat, the calculator, and the knowledge packs you have installed keep working. A ship question, an aircraft note, or a construction detail can be answered from the pack on disk, with a citation, without calling out.
              </p>
            </article>
            <article className="card px-6 py-6">
              <h3 className="text-xl font-semibold">When you are online</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                Live web search returns sources you can open. Packs can download a newer signed version in the background. If the network drops, the copy you already have stays put.
              </p>
            </article>
          </div>
        </Block>

        <Block id="agents">
          <h2 className="text-3xl font-semibold tracking-tight">Your agents</h2>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Each card comes from that agent’s folder. General is the one you can download today. The others are listed so you can see what is planned. They do not open in this build.
          </p>
          <AgentCards agents={agents} />
        </Block>

        <Block id="documents">
          <h2 className="text-3xl font-semibold tracking-tight">Documents</h2>
          <p className="mt-3 max-w-2xl text-[var(--muted)]">
            Fill one document from another, keep the formatting you already have, and convert between the formats the app can read. The files stay on this computer.
          </p>
        </Block>

        <Block id="start">
          <h2 className="text-3xl font-semibold tracking-tight">Get started in minutes</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            <li className="rounded-3xl bg-[var(--bg-side)] px-5 py-5">
              <div className="text-sm font-semibold text-[var(--accent-text)]">1</div>
              <h3 className="mt-2 text-xl font-semibold">Download</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Pick the button for this computer. macOS and Windows are separate installers.</p>
            </li>
            <li className="rounded-3xl bg-[var(--bg-side)] px-5 py-5">
              <div className="text-sm font-semibold text-[var(--accent-text)]">2</div>
              <h3 className="mt-2 text-xl font-semibold">One-click model setup</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The first launch reads your memory and downloads the matching model. You can pause and resume.</p>
            </li>
            <li className="rounded-3xl bg-[var(--bg-side)] px-5 py-5">
              <div className="text-sm font-semibold text-[var(--accent-text)]">3</div>
              <h3 className="mt-2 text-xl font-semibold">Meet Star Surf</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The companion settles next to the first chat. After that, the app does not need the network.</p>
            </li>
          </ol>
          <div className="card mt-6 px-6 py-6" id="download">
            <div className="md:flex md:items-start md:justify-between md:gap-8">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight">Download {product.name}</h3>
                <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--muted)]">
                  Unsigned beta. On a Mac, use Open Anyway once. On Windows, choose More info, then Run anyway. You only do this once.
                </p>
              </div>
              <DownloadCard />
            </div>
            {BETA_UNSIGNED && <BetaUnsignedNote />}
          </div>
        </Block>

        <Block id="privacy">
          <h2 className="text-3xl font-semibold tracking-tight">Privacy and safety</h2>
          <ul className="mt-4 max-w-2xl list-disc space-y-2 pl-5 text-[15px] leading-relaxed text-[var(--muted)]">
            <li>The assistant runs on the device.</li>
            <li>Local storage is encrypted.</li>
            <li>The app asks before an action that cannot be undone.</li>
            <li>Telemetry is off unless you turn it on.</li>
            <li>Your data is not for sale.</li>
          </ul>
          <p className="mt-4 text-sm text-[var(--muted)]">
            <a href="/privacy">Privacy</a>
            {' · '}
            <a href="/security">Security</a>
            {' · '}
            <a href="/terms">Terms</a>
          </p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            These pages are drafts, not legal advice. They do not claim a certification, and they do not claim that data cannot be leaked.
          </p>
        </Block>

        <Block id="faq">
          <h2 className="text-3xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-4 flex max-w-3xl flex-col gap-2">
            {FAQ.map((item) => (
              <details key={item.q} className="card px-5 py-4">
                <summary className="cursor-pointer text-[15px] font-semibold">{item.q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{item.a}</p>
              </details>
            ))}
          </div>
        </Block>

        <Block>
          <div className="card flex flex-col items-start gap-4 px-6 py-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Build a niche with us</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
                Code, testing, design, docs, or a knowledge pack. The form does not store the message on our server.
              </p>
            </div>
            <a className="btn btn-primary no-underline" href="/contribute">Contribute</a>
          </div>
        </Block>
      </main>
      <SiteFooter />
    </div>
  )
}

function Vignette({ state, title, body }: { state: 'searching' | 'guiding' | 'notification'; title: string; body: string }) {
  return (
    <article className="card flex flex-col items-start px-5 py-6">
      <StarSurf state={state} size={96} />
      <h3 className="mt-4 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{body}</p>
    </article>
  )
}
