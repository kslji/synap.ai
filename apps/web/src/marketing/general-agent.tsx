import { BlobMascot } from '@surf/ui'
import { DownloadCard } from '../pages'
import { CtaBand, Faq, Section, Shell } from './shell'

const FAQ = [
  {
    q: 'Where do numbers come from?',
    a: 'Sums, conversions, and comparisons use the calculator in the app. A stock figure is quoted from the file it was read from, with the date.',
  },
  {
    q: 'What is sent when I search?',
    a: 'Only the short query, and only when web search is allowed and the network is on. Your files are not sent with it.',
  },
  {
    q: 'Can I use it with no network?',
    a: 'Yes. Offline blocks the network. Chat, the calculator, and the files already on the computer keep working.',
  },
]

export function GeneralAgentPage() {
  return (
    <Shell>
      <div data-page="general">
        <section className="hero-wash">
          <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-10 md:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="pill">Available</p>
              <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight">General, for everyday questions.</h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--muted)]">
                Chat, calculate, and look through the files you already have. It works on this computer, with or without a network.
              </p>
              <a className="btn btn-primary mt-8 no-underline" href="#download">Download</a>
            </div>
            <div className="flex justify-center">
              <BlobMascot state="idle" size={240} label="Pip with General" />
            </div>
          </div>
        </section>

        <Section title="What it can do here" lede="These steps run on the computer. The only server is for payments and licences.">
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Your files</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The app reads only the folders and files you pick. Search through them happens on this computer. It does not edit those files on its own.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Pages and news</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">When you are online and allow it, a page or a news item is fetched and then read here. Chats are not sent with that request.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">NSE and BSE</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">An Indian stock question can use the NSE or BSE end-of-day file. The answer cites that file. These figures are calculations from the cited source. This is not a recommendation to buy or sell.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Calculator</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Arithmetic and unit conversions come from the calculator, not from a guess.</p>
            </article>
          </div>
        </Section>

        <section className="mx-auto max-w-6xl px-6 pb-20">
          <div className="ink-panel">
            <h2 className="text-2xl font-semibold text-white">What leaves the computer</h2>
            <p className="mt-3 text-sm leading-relaxed">A web search sends the query only. Payments and licences use the server. The conversation stays here.</p>
          </div>
        </section>

        <Section id="download" title="Pick Qwen 2B, 4B, or 9B" lede="The size and the memory note are on each card. Then download the Mac or Windows app.">
          <div className="card mt-8 px-6 py-6">
            <DownloadCard />
          </div>
        </Section>

        <Section title="Questions">
          <Faq items={FAQ} />
        </Section>
        <CtaBand title="General is the one you can open today" body="The other agents are listed on the home page. Marine, Pilot, and Construction are coming soon." />
      </div>
    </Shell>
  )
}
