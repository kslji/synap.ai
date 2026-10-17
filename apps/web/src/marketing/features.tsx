import { BlobMascot } from '@surf/ui'
import { product } from '@surf/shared'
import { CtaBand, Section, Shell } from './shell'

export function FeaturesPage() {
  return (
    <Shell>
      <div data-page="features">
        <section className="hero-wash mx-auto max-w-6xl px-6 pb-16 pt-10">
          <p className="pill">On your computer</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight">What Synap.surf does</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">{product.tagline}</p>
        </section>
        <Section title="In this build">
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Qwen on the laptop</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Qwen 2B, Qwen 4B, and Qwen 9B. You download the file from this website. The app checks it and moves it in.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Code</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The agent in this build. It plans a change, edits files, and runs the project’s tests. Finished steps can be undone. It is not for trading or high-frequency trading.</p>
              <a className="mt-3 inline-block text-sm font-semibold" href="/agents/code">Read about Code</a>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Coming soon</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">General, Assistant, Marine, Pilot, and Construction are coming soon. They do not open in this build.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Network choice</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Offline, Online, or Auto. Offline blocks every network call. Chats and knowledge packs stay on the computer.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Pip</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The orange blob in the app shows what is happening. You can recolour Pip on this site. The installed icon stays orange.</p>
            </article>
          </div>
        </Section>
        <section className="mx-auto max-w-6xl px-6 pb-20">
          <h2 className="text-3xl font-semibold tracking-tight">Compared with a cloud chat</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Synap.surf</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The model runs on the laptop. The conversation stays in an encrypted database on that computer.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">A cloud chat</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The conversation is sent to a service on the internet. Synap.surf does not do that.</p>
            </article>
          </div>
          <div className="mt-8 flex justify-center">
            <BlobMascot state="idle" size={160} label="Pip" />
          </div>
        </section>
        <CtaBand title="Download the beta" body="macOS and Windows installers are unsigned. You allow the app once." />
      </div>
    </Shell>
  )
}
