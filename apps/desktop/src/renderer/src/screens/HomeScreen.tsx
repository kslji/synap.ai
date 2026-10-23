import { ArrowRight, ChevronDown, Code2, Cpu, FileText, Landmark, LogOut, MessageSquare, Moon, ShieldCheck, Sun } from 'lucide-react'

function displayName(userName?: string): string {
  if (!userName) return 'User'
  const raw = userName.includes('@') ? userName.split('@')[0] : userName
  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

interface AgentCard {
  id: string
  title: string
  description: string
  tags: string[]
  icon: typeof Code2
  iconClass: string
  launchLabel: string
  helper: string
  highlighted?: boolean
}

const AGENT_CARDS: AgentCard[] = [
  {
    id: 'code',
    title: 'Code Agent (IDE Workspace)',
    description:
      'Full-featured code editor with syntax tree-sitter AST, git diffing, containerized sandbox, and zero-latency Qwen 2.5 Coder weights running natively on your hardware.',
    tags: ['Tree-sitter AST', 'Git Repo Vector Index', '144 tok/sec'],
    icon: Code2,
    iconClass: 'bg-[#F97316] text-white',
    launchLabel: 'Launch Code IDE Workspace',
    helper: "Opens dedicated code editor + local AI assistant with instant '← Switch Agent' return option.",
    highlighted: true,
  },
  {
    id: 'general',
    title: 'General Synthesis Agent (Chat Studio)',
    description:
      'ChatGPT/Claude-style conversational workspace for document search, RAG on local files, multi-document synthesis, and executive summaries (Gemma 2 / Llama 3 8B).',
    tags: ['Local PDF / Doc OCR', 'Ephemeral SQLite RAG', '118 tok/sec'],
    icon: MessageSquare,
    iconClass: 'bg-[#8B5CF6] text-white',
    launchLabel: 'Launch General Chat Studio',
    helper: "Opens conversational AI window with '← Switch Agent' return button to switch anytime.",
  },
  {
    id: 'office',
    title: 'Office & Paperwork Studio',
    description:
      'Local OCR for invoices, GST receipts, tabular paperwork extraction, and auto-sorting via DocOCR 8B local vision model without cloud leakage.',
    tags: ['DocOCR 8B', 'CSV / XLSX Gen', 'Batch Scanner'],
    icon: FileText,
    iconClass: 'bg-[#E4E4EF] text-[#3F3F50]',
    launchLabel: 'Launch Office Studio',
    helper: "Opens the paperwork workspace with a '← Back to Agents' button to switch anytime.",
  },
  {
    id: 'audit',
    title: 'CA, Audit & Compliance Agent',
    description:
      'Automated Section 43B(h) MSME compliance, 45-day vendor payment verification, balance sheet cross-checks, and Form 3CD tax working papers.',
    tags: ['Tax Audit 3CD', 'Tally / SAP Parse', 'Zero Cloud Leak'],
    icon: Landmark,
    iconClass: 'bg-[#FEF3C7] text-[#B45309]',
    launchLabel: 'Launch Audit & Compliance Agent',
    helper: "Opens the compliance workspace with a '← Back to Agents' button to switch anytime.",
  },
]

export function HomeScreen({
  signedIn = false,
  userName,
  theme = 'dark',
  onStart,
  onSignIn,
  onSignOut,
  onTheme,
}: {
  signedIn?: boolean
  userName?: string
  theme?: 'dark' | 'light'
  onStart: (agentId: string) => void
  onSignIn: () => void
  onSignOut?: () => void
  onTheme?: (theme: 'dark' | 'light') => void
}) {
  const name = displayName(userName)
  return (
    <section className="min-h-full flex-1 overflow-auto bg-[#F2F2F7] text-[#17171C]" data-screen="home">
      {/* Header bar */}
      <header className="flex items-center justify-between bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F97316] text-sm font-bold text-white">S</div>
          <span className="text-lg font-bold tracking-tight">Surf<span className="text-[#F97316]">.</span></span>
        </div>
        <div className="flex items-center gap-3">
          {onTheme && (
            <button
              type="button"
              onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex h-9 w-14 items-center justify-center rounded-full bg-[#F2F2F7] text-[#6B6B7B] transition-colors hover:bg-[#E8E8F0]"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          )}
          {signedIn ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2.5 rounded-xl bg-white py-1.5 pl-1.5 pr-3 shadow-[0_1px_4px_rgba(23,23,28,0.08)]">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F97316] text-sm font-bold text-white">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="text-sm font-semibold text-[#17171C]">{name}</span>
                  <span className="font-mono text-[11px] text-[#0D9488]">Local Enclave</span>
                </div>
                <ChevronDown size={14} className="text-[#9C9CAC]" />
              </div>
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#6B6B7B] transition-colors hover:bg-[#E8E8F0]"
                  aria-label="Sign out"
                >
                  <LogOut size={15} />
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="rounded-xl bg-[#F97316] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#EA580C]"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* Main card */}
      <main className="px-6 py-6">
        <div className="mx-auto max-w-6xl rounded-3xl bg-white p-8 shadow-[0_1px_6px_rgba(23,23,28,0.05)] sm:p-10">
          {/* Welcome banner */}
          <div className="rounded-2xl bg-[#F1F1F6] px-8 py-7">
            <div className="h-2.5 w-6 rounded-full bg-[#FDBA74]" />
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-[#17171C]">Welcome back, {name}</h1>
            <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-[#5B5B6B]">
              Your offline enclaves are primed on Apple Silicon. Code, General Synthesis, Office, and Audit
              workspaces are preloaded in unified RAM with zero cloud egress.
            </p>
          </div>

          {/* Step pill */}
          <div className="mt-9 inline-flex items-center gap-2 rounded-full bg-[#D9F5E5] px-3.5 py-1.5 font-mono text-xs font-semibold text-[#0F8A4B]">
            <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
            STEP 2: SELECT WORKSPACE
          </div>

          {/* Title */}
          <h2 className="mt-4 text-[28px] font-bold leading-tight tracking-tight text-[#17171C]">
            Installed &amp; Active Sovereign Agents
          </h2>
          <p className="mt-2 text-[15px] text-[#5B5B6B]">
            Click any agent below to launch into its dedicated full-screen environment. Every agent has a clear
            &ldquo;<span className="font-semibold text-[#17171C]">← Back to Agents</span>&rdquo; button to switch back instantly.
          </p>

          {/* Agent grid */}
          <div className="mt-7 grid gap-5 lg:grid-cols-2">
            {AGENT_CARDS.map((agent) => {
              const Icon = agent.icon
              return (
                <article
                  key={agent.id}
                  className={`flex flex-col rounded-2xl border p-6 transition-shadow hover:shadow-[0_4px_16px_rgba(23,23,28,0.07)] ${
                    agent.highlighted
                      ? 'border-[#F97316] shadow-[0_0_0_1px_#F97316]'
                      : 'border-[#E4E4EE] bg-white'
                  }`}
                  data-agent-card={agent.id}
                  data-agent-status="installed"
                >
                  <div className="flex items-start justify-between">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${agent.iconClass}`}>
                      <Icon size={22} />
                    </div>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#D9F5E5] px-3 py-1 font-mono text-[11px] font-semibold text-[#0F8A4B]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
                      INSTALLED &amp; READY
                    </span>
                  </div>

                  <h3 className="mt-4 text-lg font-bold tracking-tight text-[#17171C]">{agent.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-[#5B5B6B]">{agent.description}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {agent.tags.map((tag) => (
                      <span key={tag} className="rounded-md bg-[#F1F1F6] px-2.5 py-1 font-mono text-[11px] text-[#5B5B6B]">
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="mt-auto pt-5">
                    <div className="border-t border-[#EDEDF3] pt-5" />
                    <button
                      type="button"
                      data-start-chat={agent.id}
                      onClick={() => onStart(agent.id)}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-[15px] font-semibold transition-colors ${
                        agent.highlighted
                          ? 'bg-[#F97316] text-white hover:bg-[#EA580C]'
                          : 'bg-[#E7E7F0] text-[#17171C] hover:bg-[#E0E0EA]'
                      }`}
                    >
                      {agent.launchLabel}
                      <ArrowRight size={17} />
                    </button>
                    <p className="mt-2.5 text-center text-xs text-[#8A8A99]">{agent.helper}</p>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="flex items-center justify-between bg-white px-6 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#F97316] text-[11px] font-bold text-white">S</div>
          <span className="text-sm font-bold text-[#17171C]">Surf Desktop</span>
          <span className="text-xs text-[#8A8A99]">© 2025 Sovereign Local AI Architecture.</span>
        </div>
        <div className="flex items-center gap-5 text-xs text-[#5B5B6B]">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-[#0F8A4B]" />
            SOC-2 Air-Gap Certified
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Cpu size={14} className="text-[#F97316]" />
            Apple Silicon &amp; CUDA Native
          </span>
        </div>
      </footer>
    </section>
  )
}

export function AgentsScreen({ onStart }: { onStart: (agentId: string) => void }) {
  return (
    <section className="flex-1 overflow-auto bg-[#F2F2F7] text-[#17171C]" data-screen="agents">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
        <p className="mt-1 text-sm text-[#5B5B6B]">Each agent keeps its own chats.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {AGENT_CARDS.map((agent) => (
            <article key={agent.id} className="rounded-2xl border border-[#E4E4EE] bg-white p-6">
              <h3 className="text-lg font-bold">{agent.title}</h3>
              <p className="mt-2 text-sm text-[#5B5B6B]">{agent.description}</p>
              <button
                type="button"
                className="mt-4 rounded-xl bg-[#F97316] px-4 py-2 text-sm font-semibold text-white hover:bg-[#EA580C]"
                onClick={() => onStart(agent.id)}
              >
                Launch
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export function ChatsScreen({
  agentName,
  conversations,
  agentId,
  onOpen,
  onNew,
}: {
  agentName?: string
  conversations: Array<{ id: string; title: string; agentId: string }>
  agentId: string
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const mine = conversations.filter((chat) => chat.agentId === agentId)
  return (
    <section className="flex-1 overflow-auto bg-[#F2F2F7] text-[#17171C]" data-screen="chats">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{agentName ?? 'Chats'}</h1>
            <p className="mt-1 text-sm text-[#5B5B6B]">Only this agent's history is listed here.</p>
          </div>
          <button
            className="rounded-xl bg-[#F97316] px-4 py-2 text-sm font-semibold text-white hover:bg-[#EA580C]"
            type="button"
            onClick={onNew}
          >
            Start chat
          </button>
        </div>
        {mine.length === 0 ? (
          <div className="mt-8 flex flex-col items-center px-6 py-10 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white">
              <MessageSquare size={40} className="text-[#9C9CAC]" />
            </div>
            <p className="mt-2 text-sm text-[#5B5B6B]">No chats with {agentName ?? 'this agent'} yet.</p>
          </div>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {mine.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  className="w-full rounded-xl border border-[#E4E4EE] bg-white px-4 py-3 text-left text-sm font-medium hover:bg-[#FAFAFC]"
                  onClick={() => onOpen(chat.id)}
                >
                  {chat.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
