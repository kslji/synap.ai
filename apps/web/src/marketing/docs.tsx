import { agents } from '../../../../packages/shared/src/agent-catalog'
import { BUNDLED_ASSETS } from '../site'
import { MAC_STEPS, WINDOWS_STEPS } from '../pages'
import { leadWithCode, websiteAgentState } from './site-agents'
import { Shell } from './shell'

const JUMP = [
  ['install', 'Install'],
  ['open', 'Open the app'],
  ['model', 'Pick a model'],
  ['agents', 'Agents'],
  ['network', 'Network'],
  ['privacy', 'Privacy'],
  ['storage', 'Storage'],
] as const

export function DocsPage() {
  return (
    <Shell>
      <div className="mx-auto grid max-w-6xl gap-10 px-6 pb-20 pt-8 md:grid-cols-[200px_1fr]" data-page="docs">
        <nav className="flex flex-col gap-2 text-sm" aria-label="On this page">
          {JUMP.map(([id, label]) => (
            <a key={id} href={`#${id}`}>{label}</a>
          ))}
        </nav>
        <div className="flex flex-col gap-12">
          <header>
            <p className="pill">Docs</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight">Install and use Synap.surf</h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">
              The beta installers are unsigned. You allow the app once, pick a model on this website, and chat stays on the computer.
            </p>
          </header>

          <section id="install" aria-labelledby="install-title">
            <h2 id="install-title" className="text-2xl font-semibold">Download</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">The buttons on the home page point at these installers:</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {BUNDLED_ASSETS.map((asset) => <li key={asset.name}><span className="font-mono text-[13px]">{asset.name}</span></li>)}
            </ul>
            <p className="mt-3 text-sm text-[var(--muted)]">Older builds, if any, are listed on the releases page linked as All downloads. The download buttons themselves are a .dmg or a .exe.</p>
          </section>

          <section id="open" aria-labelledby="open-title">
            <h2 id="open-title" className="text-2xl font-semibold">Open the unsigned app</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <article className="card px-5 py-5">
                <h3 className="text-lg font-semibold">Mac</h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
                  {MAC_STEPS.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </article>
              <article className="card px-5 py-5">
                <h3 className="text-lg font-semibold">Windows</h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-[var(--muted)]">
                  {WINDOWS_STEPS.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </article>
            </div>
          </section>

          <section id="model" aria-labelledby="model-title">
            <h2 id="model-title" className="text-2xl font-semibold">Pick a model in the app</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              After you install, the first open asks you to pick Qwen 2B, Qwen 4B, or Qwen 9B. EmbeddingGemma downloads with it. If that Qwen file is already in Downloads and the check matches, the app offers to use it.
            </p>
            <p className="mt-3"><a href="/#download">Go to the download</a></p>
          </section>

          <section id="agents" aria-labelledby="agents-title">
            <h2 id="agents-title" className="text-2xl font-semibold">Agents</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {leadWithCode(agents).map((agent) => {
                const state = websiteAgentState(agent.id)
                return (
                  <li key={agent.id} className="card px-4 py-4" data-agent-card={agent.id} data-site-agent={state}>
                    <div className="font-semibold">{agent.name} · {state === 'ready' ? 'In this build' : 'Coming soon'}</div>
                    <p className="mt-1 text-sm text-[var(--muted)]">{agent.description}</p>
                  </li>
                )
              })}
            </ul>
          </section>

          <section id="network" aria-labelledby="network-title">
            <h2 id="network-title" className="text-2xl font-semibold">Network modes</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              Settings has three modes. Offline blocks every network call. Online allows them, including web search when you have turned that on. Auto follows the operating system and is the usual setting.
            </p>
          </section>

          <section id="privacy" aria-labelledby="privacy-title">
            <h2 id="privacy-title" className="text-2xl font-semibold">Privacy</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              Chats and documents stay on the device in an encrypted database. The full wording is on the privacy page. Naming a law there is not a certification.
            </p>
            <p className="mt-3"><a href="/privacy">Privacy</a> · <a href="/security">Security</a> · <a href="/terms">Terms</a></p>
          </section>

          <section id="storage" aria-labelledby="storage-title">
            <h2 id="storage-title" className="text-2xl font-semibold">Storage and clearing cache</h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
              Open Settings, then Storage. Clear asks before it deletes. The groups are Models, Knowledge packs, Project indexes, Chat history, Saved web, and Logs. Screenshots the app saved are listed only when that folder already has files.
            </p>
            <div className="ink-panel mt-4">
              <p className="text-sm leading-relaxed">To remove everything the app stored, quit Synap.surf and delete its data folder.</p>
              <p className="mt-2 font-mono text-[13px] text-white">~/Library/Application Support/surf-ai</p>
              <p className="mt-1 font-mono text-[13px] text-white">%APPDATA%\surf-ai</p>
            </div>
          </section>
        </div>
      </div>
    </Shell>
  )
}
