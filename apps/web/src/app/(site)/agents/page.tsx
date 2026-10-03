import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/site/button";
import { agents } from "@/lib/site-content";

export const metadata: Metadata = {
  title: "Agent catalog — Synap.surf",
  description: "Explore Synap.surf agents for creative writing, finance, investing, crypto and kundali.",
};

export default function AgentsPage() {
  return (
    <main className="site-container min-h-[75vh] py-16">
      <p className="kicker mb-4">(01) AGENT CATALOG</p>
      <h1 className="font-display text-4xl font-extrabold md:text-6xl">
        One platform.
        <br />
        <span className="text-primary">Many perspectives.</span>
      </h1>
      <p className="mt-6 max-w-2xl text-lg text-foreground/70">
        Each agent is designed around a clear objective. The catalog will grow and evolve as agents are tested and
        improved for accuracy and usefulness.
      </p>
      <p className="mt-5 text-sm text-muted-foreground">
        Download counts are illustrative, not live figures. Model labels describe intended focus; the underlying models
        have not been confirmed.
      </p>
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent, i) => (
          <article
            className={`signal-card flex min-h-64 flex-col p-6 ${i === 0 ? "signal-card-dark" : ""}`}
            key={agent.name}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="kicker">
                0{i + 1} / {agent.category}
              </span>
              {agent.sampleDownloads ? (
                <span className="text-right text-xs opacity-70">Sample · {agent.sampleDownloads} downloads</span>
              ) : null}
            </div>
            <h2 className="mt-10 font-display text-2xl font-bold">{agent.name}</h2>
            <p className="mt-1 text-xs font-semibold opacity-70">Focus · {agent.model}</p>
            <p className="mt-3 text-sm leading-relaxed opacity-70">{agent.summary}</p>
            <span className="mt-auto pt-7 text-xs font-semibold opacity-60">
              {i === 5 ? "Custom requests welcome" : "Catalog concept"}
            </span>
          </article>
        ))}
      </div>
      <div className="mt-12 border-t border-border pt-10">
        <h2 className="section-heading">Need a different niche?</h2>
        <p className="mt-3 text-foreground/70">Tell us what your personal or business agent should do.</p>
        <Button asChild variant="signal" className="mt-6">
          <Link href="/business">
            Explore custom agents <ArrowRight />
          </Link>
        </Button>
      </div>
    </main>
  );
}
