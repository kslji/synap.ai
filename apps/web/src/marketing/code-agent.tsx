import { BlobMascot } from '@surf/ui'
import { BetaUnsignedNote } from '../beta-note'
import { DownloadCard } from '../pages'
import { CtaBand, Faq, Section, Shell } from './shell'

const FAQ = [
  {
    q: 'Does Code need the internet?',
    a: 'Everyday coding works offline, once a model is on the computer. Offline blocks the network. Tests still run on this computer.',
  },
  {
    q: 'Can I undo a step?',
    a: 'Yes. Each finished step can be undone on its own, or you can undo them all.',
  },
  {
    q: 'What is Ask and Auto?',
    a: 'Ask waits for you. Auto can run after you turn it on. The app asks before that switch.',
  },
]

export function CodeAgentPage() {
  return (
    <Shell>
      <div data-page="code">
        <section className="hero-wash">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-10 md:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="pill">Available</p>
              <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight">Code, on this computer.</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
                Code splits a big task into small checked steps. It can plan, edit, and run the project’s tests. Each finished step can be undone. It is not for trading or high-frequency trading.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a className="btn btn-primary no-underline" href="#download">Get a model</a>
                <a className="btn btn-ghost no-underline" href="/docs">Install steps</a>
              </div>
            </div>
            <div className="flex justify-center">
              <BlobMascot state="working" size={240} label="Pip working with Code" />
            </div>
          </div>
        </section>

        <Section title="How a change goes" lede="You describe the change. Code writes a short plan, then works through it.">
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Plan</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">A checklist of small steps. You can reorder or remove steps before they run.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Edit and test</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">A step can edit files and run the project’s tests. You can attach a screenshot. It does not build a live preview of a screen.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Undo</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Finished steps can be undone one by one, or all at once.</p>
            </article>
          </div>
        </Section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="ink-panel">
            <h2 className="text-2xl font-semibold text-white">What you see while it works</h2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              <li>The plan sits in the chat as a checklist.</li>
              <li>Ask mode waits. Auto mode runs only after you enable it.</li>
              <li>If you stop it, finished steps can still be undone.</li>
            </ol>
          </div>
        </section>

        <Section id="download" title="Same models as the rest of the app" lede="One installer. After you install, the app downloads one Qwen model (Qwen 4B, needs 8 GB of memory) with the search model. An offline installer already has both files. Code uses that Qwen.">
          <div className="card mt-8 px-6 py-6">
            <DownloadCard />
            <BetaUnsignedNote />
          </div>
        </Section>

        <Section title="Questions">
          <Faq items={FAQ} />
        </Section>
        <CtaBand title="Code stays on the laptop" body="Open a project folder in the app. The index stays in the app’s private data folder." />
      </div>
    </Shell>
  )
}
