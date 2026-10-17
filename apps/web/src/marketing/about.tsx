import { BlobMascot } from '@surf/ui'
import { product } from '@surf/shared'
import { PipMoods, PipPicker } from './pip'
import { CtaBand, Section, Shell } from './shell'

export function AboutPage() {
  return (
    <Shell>
      <div data-page="about">
        <section className="hero-wash mx-auto max-w-6xl px-6 pb-16 pt-10">
          <p className="pill">{product.name}</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight">A local AI app, with Pip.</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
            {product.tagline} The model is an open Qwen build that runs on your laptop. The server is for payments and licences.
          </p>
        </section>
        <Section title="Three things that are true">
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">On the computer</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Chat, the files you add, and knowledge packs stay here. Turning those files into a search index happens on this computer.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">Network is a choice</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Offline, Online, or Auto. Offline means no network calls at all.</p>
            </article>
            <article className="card px-5 py-5">
              <h3 className="text-xl font-semibold">You can read the source</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The project is on <a href={product.repo}>GitHub</a>. The privacy and security pages describe the controls. They are not a certification.</p>
            </article>
          </div>
        </Section>
        <section id="pip" className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby="pip-title">
          <p className="pill">Pip</p>
          <h2 id="pip-title" className="mt-4 text-4xl font-semibold tracking-tight">Meet Pip</h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
            Pip is the orange blob in the app. The pose follows what the app is doing. Pick a colour here. Offline looks quieter because the network is blocked.
          </p>
          <div className="mt-8 flex justify-center">
            <BlobMascot state="idle" size={220} followCursor label="Pip" />
          </div>
          <div className="mt-6">
            <PipPicker />
          </div>
          <PipMoods />
        </section>
        <CtaBand title="Want to help?" body="Code, testing, design, docs, or a knowledge pack. The contribute form does not store the message on our server." />
        <p className="mx-auto max-w-6xl px-6 pb-16 text-sm"><a href="/contribute">Contribute</a></p>
      </div>
    </Shell>
  )
}
