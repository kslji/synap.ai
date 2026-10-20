import { useRef } from 'react'
import { BlobMascot, useParallax } from '@surf/ui'
import { product } from '@surf/shared'
import { BetaUnsignedNote } from '../beta-note'
import { DownloadCard } from '../pages'
import { AgentSuite } from './agents'
import { CtaBand, Faq, Section, Shell } from './shell'
import { PRICING_NOTICE } from '../pricing-config'

const FAQ = [
  {
    q: 'Which computers can run it?',
    a: 'macOS 12 or newer, Apple silicon and Intel, and Windows 10 or 11, 64-bit. A GPU is optional. Leave room for the model file as well as the app.',
  },
  {
    q: 'Does the chat need the internet?',
    a: 'No. After a model is on the computer, chat still works with the network off. Offline blocks every network call. Online allows them. Auto follows the operating system, and it is the usual setting.',
  },
  {
    q: 'Is the beta free?',
    a: 'The unsigned Mac and Windows beta installers are free to download. Licence prices are not set yet.',
  },
  {
    q: 'What stays on the computer?',
    a: 'Chats, the files you pick, and knowledge packs stay on the computer. A web search, when you allow it, sends only the short query.',
  },
]

export function HomePage() {
  const hero = useRef<HTMLElement>(null)
  useParallax(hero)

  return (
    <Shell>
      <div data-page="home">
        <section ref={hero} className="hero-wash parallax">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-10 md:grid-cols-[1.1fr_0.9fr]">
            <div className="hero-copy parallax-layer">
              <span className="pill">Offline Autonomous AI</span>
              <h1 className="mt-4 text-5xl font-semibold leading-[1.08] tracking-tight md:text-6xl text-[var(--ink)]">
                Code runs on your laptop. Autonomous and local.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
                {product.tagline} Plan features, refactor codebases, and execute tests directly in your environment. Full undoable checkpoints, local model inference, and airtight privacy with zero cloud dependencies.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a className="btn btn-primary no-underline shadow-sm" href="#download">Download Installer</a>
                <a className="btn btn-ghost no-underline" href="/agents/code">Explore Code Agent</a>
              </div>
            </div>
            <div className="hero-art parallax-layer flex justify-center">
              <BlobMascot state="idle" size={280} followCursor label="Pip, the Synap.surf companion" />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby="here-title">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <p className="pill">Architecture &amp; Privacy</p>
              <h2 id="here-title" className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Private by design. Zero telemetry.</h2>
            </div>
            <p className="max-w-md text-sm text-[var(--muted)] leading-relaxed">
              Engineered from the ground up for strict privacy, offline autonomy, and sensitive intellectual property.
            </p>
          </div>

          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <div className="card group relative overflow-hidden p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] mb-4">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-[var(--ink)]">100% On-Device Storage</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                Conversations, indexed repositories, and embeddings are stored inside a hardware-encrypted SQLite database on your machine. Your proprietary code never leaves localhost.
              </p>
            </div>

            <div className="card group relative overflow-hidden p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] mb-4">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-[var(--ink)]">Private Local Inference</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                A local Qwen model executes in a native sandboxed sidecar via hardware acceleration (Metal, Vulkan, CUDA). Even web lookups are strictly query-only, reading pages entirely on-device.
              </p>
            </div>

            <div className="card group relative overflow-hidden p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)] mb-4">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold tracking-tight text-[var(--ink)]">Zero Cloud Telemetry</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                We collect zero tracking pixels, prompts, code snippets, or conversational analytics. Remote endpoints are utilized exclusively for offline licence validation and cryptographically signed update packages.
              </p>
            </div>
          </div>
        </section>

        <Section id="agents" kicker="Autonomous Agents" title="Specialized AI Agents tailored for deep workflows" lede="Explore our suite of purpose-built domain agents. Code is live and production-ready in this release.">
          <AgentSuite />
        </Section>

        <Section id="network" kicker="Network Policy" title="Granular network modes: Offline, Online, or Auto" lede="Select your networking profile in Settings to strictly control sidecar outbound access.">
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="card p-6 transition-all hover:border-[var(--accent)]">
              <span className="pill text-xs">Fully Offline</span>
              <h3 className="mt-3 text-xl font-semibold">Offline Mode</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Every outbound packet is hard-blocked. All inferences and searches execute exclusively against local indexes and weights.</p>
            </article>
            <article className="card p-6 transition-all hover:border-[var(--accent)]">
              <span className="pill text-xs">Connected</span>
              <h3 className="mt-3 text-xl font-semibold">Online Mode</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Permission-gated live search and knowledge sync. Allows real-time documentation retrieval and verified package updates.</p>
            </article>
            <article className="card p-6 transition-all hover:border-[var(--accent)]">
              <span className="pill text-xs">Adaptive</span>
              <h3 className="mt-3 text-xl font-semibold">Auto Policy</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Automatically mirrors your OS network interface state. Instantly transitions to strict offline isolation when connectivity drops.</p>
            </article>
          </div>
        </Section>

        <Section id="download" title="Download the app" lede="One installer for your computer. After you install, the app downloads one Qwen model that works on any laptop with 8 GB of memory or more. There is also an offline installer with the model and search model already inside.">
          <div className="card mt-8 px-6 py-6">
            <DownloadCard />
            <BetaUnsignedNote />
          </div>
        </Section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="card px-6 py-8">
            <h2 className="text-3xl font-semibold tracking-tight">{PRICING_NOTICE}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              The beta installers are free to download. Licence prices are not set, so this site does not show a price.
            </p>
            <a className="mt-4 inline-block text-sm font-semibold" href="/pricing">Read about pricing</a>
          </div>
        </section>

        <Section id="faq" title="Questions">
          <Faq items={FAQ} />
        </Section>
        <CtaBand title="Run it on your laptop" body={`${product.name} is an unsigned beta for macOS and Windows. Open it once past the system warning, then it stays on the computer.`} />
      </div>
    </Shell>
  )
}
