import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Download } from "lucide-react";
import { Button } from "@/components/site/button";
import { agents } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Synap.surf — Local-first AI agents",
  description: "Explore purpose-built AI agents and a local-first desktop platform for work online or offline.",
};

const packages = [
  ["macOS", "DMG", "For Mac computers"],
  ["Windows", "EXE", "For Windows computers"],
  ["Portable", "ZIP", "Archive package"],
] as const;

export default function HomePage() {
  return (
    <main className="site-container">
      <section className="grid grid-cols-12 gap-4 pt-14 pb-12 md:pt-20">
        <div className="col-span-12 animate-rise lg:col-span-7">
          <p className="kicker mb-5 flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-primary" /> SYNAP.SURF — LOCAL-FIRST AI DESKTOP
          </p>
          <h1 className="font-display text-[clamp(2.6rem,5.8vw,5rem)] leading-[1.02] font-extrabold text-balance">
            Your agents,
            <br />
            <span className="text-primary">on your machine.</span>
          </h1>
          <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-foreground/70">
            A local-first AI desktop platform with focused agents for creativity, finance, investing, crypto and
            kundali. Work with your tools online or offline.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="signal" size="lg">
              <Link href="/download">
                Get Synap.surf <ArrowDown />
              </Link>
            </Button>
            <Button asChild variant="signalOutline" size="lg">
              <Link href="/agents">Browse agents</Link>
            </Button>
          </div>
          <div className="kicker mt-8 flex flex-wrap gap-x-8 gap-y-3">
            <span>· Local-first</span>
            <span>· Online or offline</span>
            <span>· Purpose-built agents</span>
          </div>
        </div>
        <div className="col-span-12 animate-rise lg:col-span-5 lg:pt-8">
          <div className="console-visual" aria-label="Illustrative animation of an AI agent conversation">
            <div className="mb-5 flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-primary" />
              <span className="size-2.5 rounded-full bg-accent" />
              <span className="size-2.5 rounded-full bg-background/30" />
              <span className="ml-auto text-[10px] text-background/50">synap://local</span>
            </div>
            <div className="console-inner console-conversation">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] uppercase text-background/50">Ledger · Finance reasoning model</span>
                <span className="rounded-full bg-accent px-2 py-1 text-[10px] font-bold text-accent-foreground">
                  ● OFFLINE
                </span>
              </div>
              <div className="mt-5 flex justify-end">
                <div className="console-message-user">Can you help outline a Q3 cash-flow brief?</div>
              </div>
              <div className="mt-5 flex items-start gap-2.5">
                <span className="console-agent-avatar" aria-hidden="true">
                  S
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mb-2 text-[10px] font-bold text-background/60">SYNAP AGENT</p>
                  <div className="console-response-area">
                    <div className="console-typing" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <p className="console-message-agent">
                      Start with opening cash, then group operating inflows and outflows. Close with net change and the
                      assumptions behind your forecast.
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-5 border-t border-background/10 pt-3 text-[10px] text-background/50">
                ILLUSTRATIVE PREVIEW · LOCAL WORKSPACE
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-4 py-12" aria-labelledby="download-heading">
        <div className="col-span-12 lg:col-span-4">
          <p className="kicker mb-3">(a) DOWNLOAD</p>
          <h2 id="download-heading" className="section-heading">
            Your platform.
            <br />
            Your format.
          </h2>
          <p className="mt-4 max-w-[34ch] text-foreground/70">
            Choose the desktop package that works for you. Available releases and setup information live together on
            the downloads page.
          </p>
        </div>
        <div className="col-span-12 grid gap-4 sm:grid-cols-3 lg:col-span-8">
          {packages.map(([os, ext, detail]) => (
            <div key={ext} className="signal-card flex flex-col">
              <div className="flex items-center justify-between">
                <span className="kicker">PACKAGE</span>
                <span className="format-tag">{ext}</span>
              </div>
              <h3 className="mt-7 font-display text-2xl font-bold">{os}</h3>
              <p className="mt-1 text-xs text-foreground/60">{detail}</p>
              <Button asChild variant="signalDark" className="mt-7 w-full">
                <Link href="/download">
                  <Download /> Check {ext}
                </Link>
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="py-12" aria-labelledby="agents-heading">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="kicker mb-3">(b) AGENT CATALOG</p>
            <h2 id="agents-heading" className="section-heading">
              Focused agents. Distinct jobs.
            </h2>
          </div>
          <Link href="/agents" className="text-sm font-semibold underline underline-offset-4 hover:text-primary">
            Explore all agents <ArrowRight className="inline size-4" />
          </Link>
        </div>
        <div className="mb-4 overflow-hidden border-y border-border py-3" aria-label="Illustrative agent download figures">
          <div className="agent-ticker flex w-max gap-8 text-xs font-semibold">
            {[...agents.slice(0, 5), ...agents.slice(0, 5)].map((agent, i) => (
              <span
                key={`${agent.name}-${i}`}
                className="flex items-center gap-3 whitespace-nowrap"
                aria-hidden={i >= 5}
              >
                <span className="size-1.5 rounded-full bg-primary" />
                <span>{agent.name}</span>
                <span className="text-muted-foreground">
                  {agent.category.toLowerCase()} · {agent.model}
                </span>
                <span className="text-primary">Sample {agent.sampleDownloads} downloads</span>
              </span>
            ))}
          </div>
        </div>
        <p className="mb-5 text-xs text-muted-foreground">
          Download figures are illustrative, not live counts. Model labels describe intended focus, not confirmed
          underlying models.
        </p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent, i) => (
            <article key={agent.name} className={`signal-card min-h-56 ${i === 0 ? "signal-card-dark" : ""}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="kicker">{agent.category}</span>
                {agent.sampleDownloads ? (
                  <span className="text-right text-xs opacity-70">Sample · {agent.sampleDownloads} downloads</span>
                ) : null}
              </div>
              <h3 className="mt-10 font-display text-2xl font-bold">{agent.name}</h3>
              <p className="mt-1 text-xs font-semibold opacity-70">Focus · {agent.model}</p>
              <p className="mt-3 max-w-[33ch] text-sm leading-relaxed opacity-70">{agent.summary}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-12 gap-4 py-12" aria-labelledby="business-heading">
        <div className="signal-card col-span-12 p-7 md:p-9 lg:col-span-7">
          <p className="kicker mb-3">(c) CUSTOM BUSINESS AGENTS</p>
          <h2 id="business-heading" className="section-heading">
            An agent for your business, not everyone else&apos;s.
          </h2>
          <p className="mt-4 max-w-[52ch] text-foreground/70">
            Tell us your niche, objectives and workflow. We can help scope a personal agent designed around the work
            that matters to you.
          </p>
          <Button asChild variant="signal" size="lg" className="mt-7">
            <Link href="/business">
              Explore custom agents <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="signal-card signal-card-dark col-span-12 p-7 md:p-9 lg:col-span-5">
          <p className="kicker mb-5">HOW IT WORKS</p>
          <ol className="space-y-5 text-sm">
            {["Define the niche and objective.", "Shape the agent's knowledge and boundaries.", "Test, refine and improve its outputs."].map(
              (item, i) => (
                <li key={item} className="flex gap-4">
                  <span className="text-primary">0{i + 1}</span>
                  <span className="opacity-80">{item}</span>
                </li>
              ),
            )}
          </ol>
        </div>
      </section>

      <section className="grid grid-cols-12 gap-4 py-12">
        <div className="col-span-12 lg:col-span-5">
          <p className="kicker mb-3">(d) CONTACT</p>
          <h2 className="section-heading">Let&apos;s build something useful.</h2>
          <p className="mt-4 max-w-[38ch] text-foreground/70">
            Questions about Synap or a custom agent for your business? Get in touch.
          </p>
          <Button asChild variant="signalDark" size="lg" className="mt-6">
            <Link href="/contact">
              Contact us <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="signal-card col-span-12 grid gap-8 p-7 sm:grid-cols-2 md:p-8 lg:col-span-7">
          <div>
            <p className="kicker mb-4">POLICIES</p>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link className="hover:text-primary" href="/privacy">
                  Privacy policy
                </Link>
              </li>
              <li>
                <Link className="hover:text-primary" href="/terms">
                  Terms of service
                </Link>
              </li>
              <li>
                <Link className="hover:text-primary" href="/acceptable-use">
                  Acceptable use
                </Link>
              </li>
              <li>
                <Link className="hover:text-primary" href="/security">
                  Security & data
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="kicker mb-4">PRODUCT</p>
            <ul className="space-y-2.5 text-sm">
              <li>
                <Link className="hover:text-primary" href="/agents">
                  Agent catalog
                </Link>
              </li>
              <li>
                <Link className="hover:text-primary" href="/business">
                  Custom agents
                </Link>
              </li>
              <li>
                <Link className="hover:text-primary" href="/download">
                  Downloads
                </Link>
              </li>
              <li>
                <Link className="hover:text-primary" href="/disclaimers">
                  AI disclaimers
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
