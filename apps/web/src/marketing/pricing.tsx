import { licenceTerms, PRICING_NOTICE, termPrice } from '../pricing-config'
import { Faq, Shell } from './shell'

const FAQ = [
  {
    q: 'Why is there no price?',
    a: 'Licence prices are not set. This page will show them when they are. It will not show a placeholder price.',
  },
  {
    q: 'Is the installer free?',
    a: 'The unsigned Mac and Windows beta installers are free to download.',
  },
  {
    q: 'What does a licence cover, once prices exist?',
    a: 'The Buy page already says a licence usually covers two computers, and that plans run for 1, 3, 6, or 12 months. Checkout on that page is not open yet.',
  },
]

export function PricingPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-6xl px-6 pb-20 pt-10" data-page="pricing">
        <p className="pill">{PRICING_NOTICE}</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight">Pricing coming soon</h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--muted)]">
          No price is filled in. The lengths below are the licence terms the app already describes. Each card stays blank until a real amount is set.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {licenceTerms.map((term) => (
            <article key={term.id} className="card flex flex-col px-5 py-6" data-price-term={term.id}>
              <h2 className="text-xl font-semibold">{term.months === 1 ? '1 month' : `${term.months} months`}</h2>
              <p className="mt-6 text-lg font-semibold text-[var(--accent-text)]" data-price-amount={term.id}>{termPrice(term)}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-[var(--muted)]">Amount not set.</p>
            </article>
          ))}
        </div>
        <p className="mt-8 text-sm text-[var(--muted)]">
          The <a href="/buy">Buy</a> page explains the licence. Checkout there is not open.
        </p>
        <Faq items={FAQ} />
      </div>
    </Shell>
  )
}
