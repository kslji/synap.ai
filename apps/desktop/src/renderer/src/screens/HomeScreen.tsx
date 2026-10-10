import type { AgentCardView } from '../../../shared/ipc-contract'

export const FALLBACK_AGENTS: AgentCardView[] = [
  { id: 'general', name: 'General', description: 'Everyday answers from your documents, packs, and the web when you are online.', home: true, scope: [], outOfScope: [] },
  { id: 'code', name: 'Code + UI', description: 'Product and SaaS engineering: architecture, code, and a sandboxed interface preview. Not for trading or HFT.', note: 'Not for trading or HFT.', home: true, scope: [], outOfScope: [] },
  { id: 'assistant', name: 'Assistant', description: 'Inbox, calendar, files, and invoices on this computer. Sends and deletes wait for your approval.', home: true, scope: [], outOfScope: [] },
]

export function HomeScreen({ cards, onOpen }: { cards: AgentCardView[]; onOpen: (id: string) => void }) {
  const shown = cards.length ? cards : FALLBACK_AGENTS
  return (
    <section className="flex-1 overflow-auto px-8 py-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">Each agent runs on this computer. Marine comes later.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {shown.map((card) => (
            <button key={card.id} type="button" className="card px-5 py-4 text-left" data-agent-card={card.id} onClick={() => onOpen(card.id)}>
              <h2 className="text-lg font-semibold">{card.name}</h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{card.description}</p>
              {card.note && <span className="pill pill-warn mt-3">{card.note}</span>}
            </button>
          ))}
          <article className="card px-5 py-4 opacity-70" data-agent-card="marine">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Marine</h2>
              <span className="pill pill-muted">Soon</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">Navigation and vessel paperwork. Not in this build.</p>
          </article>
        </div>
      </div>
    </section>
  )
}
