import type { ReactNode } from 'react'
import { SiteFooter, SiteHeader, useTheme } from '../pages'

export function Shell({ children }: { children: ReactNode }) {
  const [theme, onTheme] = useTheme()
  return (
    <div>
      <a className="skip-link" href="#top">Skip to content</a>
      <SiteHeader theme={theme} onTheme={onTheme} />
      <main id="top">{children}</main>
      <SiteFooter />
    </div>
  )
}

export function Section({ id, kicker, title, lede, children }: { id?: string; kicker?: string; title: string; lede?: string; children?: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl px-6 pb-20" aria-labelledby={id ? `${id}-title` : undefined}>
      {kicker && <p className="pill">{kicker}</p>}
      <h2 id={id ? `${id}-title` : undefined} className={`${kicker ? 'mt-4' : ''} text-3xl font-semibold tracking-tight md:text-4xl`}>{title}</h2>
      {lede && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">{lede}</p>}
      {children}
    </section>
  )
}

export function Faq({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="mt-6 flex max-w-3xl flex-col gap-2">
      {items.map((item) => (
        <details key={item.q} className="card px-5 py-4">
          <summary className="cursor-pointer text-[15px] font-semibold">{item.q}</summary>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{item.a}</p>
        </details>
      ))}
    </div>
  )
}

export function CtaBand({ title, body }: { title: string; body: string }) {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-20">
      <div className="band flex flex-col items-start gap-4 px-6 py-8 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">{body}</p>
        </div>
        <a className="btn btn-primary no-underline" href="/#download">Download</a>
      </div>
    </section>
  )
}
