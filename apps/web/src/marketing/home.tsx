import { BlobMascot } from '@surf/ui'
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
  return (
    <Shell>
      <div data-page="home">
        <section className="hero-wash">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-10 md:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="pill">Code is in this build</p>
              <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
                Code runs on your laptop.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
                {product.tagline} Code plans a change, edits files, and runs the project’s tests. Each finished step can be undone. Chats and files stay on this computer. You pick a Qwen model on this site. The app downloads it the first time you open it.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a className="btn btn-primary no-underline" href="#download">Download the app</a>
                <a className="btn btn-ghost no-underline" href="/agents/code">Read about Code</a>
              </div>
            </div>
            <div className="flex justify-center">
              <BlobMascot state="idle" size={280} followCursor label="Pip, the Synap.surf companion" />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby="here-title">
          <h2 id="here-title" className="text-3xl font-semibold tracking-tight">On this computer</h2>
          <div className="ink-panel mt-6">
            <ul className="flex flex-col gap-3 text-sm leading-relaxed">
              <li><strong>Chats stay here.</strong> They sit in an encrypted database on the computer. The model runs here too.</li>
              <li><strong>Search is optional.</strong> When you allow a web search, only the short query is sent. Pages are read on this computer.</li>
              <li><strong>The server is for payments and licences.</strong> It does not receive the conversation.</li>
            </ul>
          </div>
        </section>

        <Section id="agents" kicker="Agents" title="Code is the agent you can use" lede="General, Assistant, Marine, Pilot, and Construction are coming soon. They are listed here, and they do not open yet.">
          <AgentSuite />
        </Section>

        <Section id="network" title="Offline, Online, or Auto" lede="You pick the mode in Settings. Auto is the usual one.">
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Offline</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Every network call is blocked. Chat still uses what is already on the computer.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Online</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Web search can run when you allow it. Knowledge packs can check for a newer signed copy.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Auto</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Follows the operating system. If the laptop is offline, the app stays offline too.</p>
            </article>
          </div>
        </Section>

        <Section id="download" title="Download the app" lede="One installer for your computer. After you install, you pick Qwen 2B, Qwen 4B, or Qwen 9B inside the app. The sizes and memory notes below are for reference.">
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
