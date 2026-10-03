"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Download, Laptop, MousePointerClick, Play, ShieldCheck } from "lucide-react";
import { Button } from "@/components/site/button";
import { agents } from "@/lib/site-content";

const stages = [
  { title: "Choose your interest", icon: MousePointerClick, short: "Pick an agent that matches what you want to do." },
  { title: "Choose your computer", icon: Laptop, short: "Choose macOS, Windows, or the portable package." },
  { title: "Check the download", icon: Download, short: "See which package is currently available on the official release page." },
  { title: "Follow the instructions", icon: ShieldCheck, short: "Open the downloaded file and follow the instructions provided with that release." },
  { title: "Open Synap", icon: Play, short: "Launch the app, choose your agent, and start on your own computer." },
];

const platforms = ["macOS · DMG", "Windows · EXE", "Portable · ZIP"] as const;

export function SetupGuide() {
  const [active, setActive] = useState(0);
  const [agent, setAgent] = useState("Verse");
  const [platform, setPlatform] = useState<(typeof platforms)[number]>("macOS · DMG");
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActive((current) => (current + 1) % stages.length), 4800);
    return () => window.clearInterval(timer);
  }, [playing]);

  const selectedAgent = agents.find((item) => item.name === agent) ?? agents[0];
  const platformHelp = platform.startsWith("macOS")
    ? "For a DMG, open the downloaded file and follow the Mac instructions shown. You may be asked to move the app to Applications."
    : platform.startsWith("Windows")
      ? "For an EXE, open the downloaded file and follow the installer prompts. Only approve prompts from a source you trust."
      : "For a ZIP, extract the archive first, then read the included setup instructions before opening anything inside.";
  const selectStep = (index: number) => {
    setActive(index);
    setPlaying(false);
  };

  return (
    <section className="mt-20 border-t border-border pt-16" aria-labelledby="guide-heading">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="kicker mb-3">A SIMPLE START</p>
          <h2 id="guide-heading" className="section-heading">
            From an idea to your computer.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground/70">
            Take it one step at a time. This is an example journey; always use the instructions on the current release
            page when installing.
          </p>
        </div>
        <Button
          variant="signalOutline"
          size="sm"
          onClick={() => setPlaying((value) => !value)}
          aria-label={playing ? "Pause guide animation" : "Play guide animation"}
        >
          {playing ? "Pause" : "Play"}
        </Button>
      </div>

      <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-12">
        <ol className="border-t border-border">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <li key={stage.title} className="border-b border-border">
                <Button
                  variant="ghost"
                  onClick={() => selectStep(index)}
                  aria-current={active === index ? "step" : undefined}
                  className={`h-auto w-full justify-start gap-4 rounded-none px-2 py-4 text-left whitespace-normal hover:bg-muted ${active === index ? "bg-muted" : ""}`}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-sm text-xs font-bold ${active === index ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
                  >
                    {index < active ? <Check className="size-4" /> : `0${index + 1}`}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-sm font-bold text-foreground">{stage.title}</span>
                    <span className="mt-1 block text-xs font-normal leading-relaxed text-muted-foreground">
                      {stage.short}
                    </span>
                  </span>
                  <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ol>

        <div className="flex min-h-[360px] flex-col border border-border bg-card p-6 sm:p-8" aria-live="polite">
          <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
            <span className="kicker">STEP 0{active + 1} / 05</span>
            <span className="text-xs font-semibold text-primary">{stages[active]?.title}</span>
          </div>
          <div key={active} className="guide-panel flex flex-1 flex-col justify-center py-7">
            {active === 0 ? (
              <>
                <p className="kicker mb-3">WHAT WOULD YOU LIKE TO DO?</p>
                <h3 className="font-display text-2xl font-bold">Find your focus.</h3>
                <div className="mt-5 flex flex-wrap gap-2">
                  {agents.slice(0, 5).map((item) => (
                    <Button
                      key={item.name}
                      variant={agent === item.name ? "signal" : "signalOutline"}
                      size="sm"
                      onClick={() => {
                        setAgent(item.name);
                        setPlaying(false);
                      }}
                    >
                      {item.name}
                    </Button>
                  ))}
                </div>
                {selectedAgent ? (
                  <p className="mt-6 text-sm text-foreground/70">
                    <strong>{selectedAgent.name}</strong> · {selectedAgent.category.toLowerCase()} ·{" "}
                    {selectedAgent.model}. {selectedAgent.summary}
                  </p>
                ) : null}
              </>
            ) : null}
            {active === 1 ? (
              <>
                <p className="kicker mb-3">YOUR DEVICE</p>
                <h3 className="font-display text-2xl font-bold">Which computer do you use?</h3>
                <div className="mt-5 flex flex-wrap gap-2">
                  {platforms.map((option) => (
                    <Button
                      key={option}
                      variant={platform === option ? "signal" : "signalOutline"}
                      size="sm"
                      onClick={() => {
                        setPlatform(option);
                        setPlaying(false);
                      }}
                    >
                      {option}
                    </Button>
                  ))}
                </div>
                <p className="mt-6 text-sm text-foreground/70">
                  Selected: <strong>{platform}</strong>. Check the release page to confirm this package and its
                  requirements before proceeding.
                </p>
              </>
            ) : null}
            {active === 2 ? (
              <>
                <p className="kicker mb-3">OFFICIAL RELEASE PAGE</p>
                <h3 className="font-display text-2xl font-bold">Check before downloading.</h3>
                <p className="mt-4 text-sm leading-relaxed text-foreground/70">
                  Look for the <strong>{platform}</strong> package. The live release on this site is the portable pack:
                  pick a model, download the zip, then run the command shown below.
                </p>
                <Button asChild variant="signalDark" className="mt-6 self-start">
                  <a href="#pack">
                    Get the pack <ArrowRight />
                  </a>
                </Button>
              </>
            ) : null}
            {active === 3 ? (
              <>
                <p className="kicker mb-3">INSTALL SAFELY</p>
                <h3 className="font-display text-2xl font-bold">Follow the release instructions.</h3>
                <p className="mt-4 text-sm leading-relaxed text-foreground/70">
                  {platformHelp} If a command is required, copy the exact command from the official release
                  instructions. There is no confirmed universal setup command to show here.
                </p>
              </>
            ) : null}
            {active === 4 ? (
              <>
                <p className="kicker mb-3">READY WHEN INSTALLED</p>
                <h3 className="font-display text-2xl font-bold">Meet {agent} on your computer.</h3>
                <p className="mt-4 text-sm leading-relaxed text-foreground/70">
                  After installation, open Synap and look for <strong>{agent}</strong>. Follow any on-screen first-run
                  instructions; some features may need internet access to get started.
                </p>
                <Button asChild variant="link" className="mt-4 self-start p-0">
                  <Link href="/agents">
                    Explore all agents <ArrowRight />
                  </Link>
                </Button>
              </>
            ) : null}
          </div>
          <div className="h-1 overflow-hidden bg-muted" aria-hidden="true">
            <div key={`${active}-${playing}`} className={`h-full bg-primary ${playing ? "guide-progress" : "w-full"}`} />
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Illustrative walkthrough · Actual options depend on the available release.
          </p>
        </div>
      </div>
    </section>
  );
}
