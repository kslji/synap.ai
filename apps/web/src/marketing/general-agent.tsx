import { BlobMascot } from '@surf/ui'
import { Shell } from './shell'

export function GeneralAgentPage() {
  return (
    <Shell>
      <article className="mx-auto max-w-3xl px-6 pb-20 pt-12" data-page="general">
        <p className="pill pill-muted">Coming soon</p>
        <h1 className="mt-4 text-5xl font-semibold leading-[1.05] tracking-tight">General is coming soon.</h1>
        <p className="mt-5 text-lg leading-relaxed text-[var(--muted)]">
          Code is the agent in this build. General is listed with Assistant, Marine, Pilot, and Construction. It does not open yet.
        </p>
        <div className="mt-8">
          <BlobMascot state="idle" size={160} label="Pip" />
        </div>
        <p className="mt-8 flex flex-wrap gap-4 text-sm font-semibold">
          <a href="/agents/code">Read about Code</a>
          <a href="/#agents">All agents</a>
        </p>
      </article>
    </Shell>
  )
}
