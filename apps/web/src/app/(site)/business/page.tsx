import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/site/button";

export const metadata: Metadata = {
  title: "Custom business agents — Synap.surf",
  description: "Discuss a personal AI agent designed for your niche, objectives and workflow with Synap.surf.",
};

const points = [
  ["Personal fit", "Shape an assistant around the language, domain and tasks that matter to you."],
  ["Human oversight", "Keep important decisions with people. Set review points for sensitive outputs."],
  ["Flexible operation", "Plan for local-first use, with connected services only when your workflow needs them."],
] as const;

export default function BusinessPage() {
  return (
    <main className="site-container min-h-[75vh] py-16">
      <p className="kicker mb-4">(02) FOR BUSINESS</p>
      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-12 lg:col-span-8">
          <h1 className="font-display text-4xl font-extrabold md:text-6xl">
            Your niche.
            <br />
            <span className="text-primary">Your agent.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-foreground/70">
            A general assistant cannot know every business. We work with you to define a personal agent around your
            objectives, knowledge, preferred workflow and the boundaries it should respect.
          </p>
          <Button asChild variant="signal" size="lg" className="mt-8">
            <Link href="/contact">
              Discuss your agent <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="signal-card signal-card-dark col-span-12 p-7 lg:col-span-4">
          <p className="kicker">A CLEAR PROCESS</p>
          <ol className="mt-8 space-y-6 text-sm">
            <li>
              <strong className="text-primary">01 / Discover</strong>
              <p className="mt-1 opacity-70">Define the niche, users and specific job to be done.</p>
            </li>
            <li>
              <strong className="text-primary">02 / Design</strong>
              <p className="mt-1 opacity-70">Choose sources, controls and a suitable local or connected workflow.</p>
            </li>
            <li>
              <strong className="text-primary">03 / Improve</strong>
              <p className="mt-1 opacity-70">Review outputs and refine the agent for greater accuracy.</p>
            </li>
          </ol>
        </div>
      </div>
      <div className="mt-16 grid gap-4 md:grid-cols-3">
        {points.map(([title, body]) => (
          <div className="signal-card p-6" key={title}>
            <h2 className="font-display text-xl font-bold">{title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-foreground/70">{body}</p>
          </div>
        ))}
      </div>
      <p className="mt-10 text-sm text-foreground/60">
        Capabilities, availability, integration options and commercial terms are agreed case by case.
      </p>
    </main>
  );
}
