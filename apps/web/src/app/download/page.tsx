import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site/site-shell";
import { siteFontClass, SiteFrame } from "@/components/site/site-frame";
import { SetupGuide } from "@/components/site/setup-guide";
import { Button } from "@/components/site/button";
import { PackDownload } from "@/components/site/pack-download";

export const metadata: Metadata = {
  title: "Download Synap — Synap.surf",
  description: "Find Synap.surf desktop download options and the current local pack.",
};

const packages = [
  ["macOS", "DMG", "For Mac computers"],
  ["Windows", "EXE", "For Windows computers"],
  ["Portable", "ZIP", "Archive package"],
] as const;

export default function DownloadPage() {
  return (
    <>
      <SiteFrame footer={false}>
        <main className="site-container min-h-[75vh] py-16">
          <p className="kicker mb-4">(03) DESKTOP</p>
          <h1 className="font-display text-4xl font-extrabold md:text-6xl">
            Take your AI
            <br />
            <span className="text-primary">with you.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-foreground/70">
            Synap is built for a local-first workflow. The live release is the portable pack below: choose a model,
            download the zip, then run the command on your computer.
          </p>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {packages.map(([name, ext, detail]) => (
              <div className="signal-card flex min-h-60 flex-col p-6" key={ext}>
                <div className="flex items-center justify-between">
                  <span className="kicker">PACKAGE</span>
                  <span className="format-tag">{ext}</span>
                </div>
                <h2 className="mt-8 font-display text-2xl font-bold">{name}</h2>
                <p className="mt-2 text-sm text-foreground/60">
                  {detail}. Check availability and requirements before installing.
                </p>
                <Button asChild variant="signalDark" className="mt-auto w-full">
                  <a href="#pack">Check {ext}</a>
                </Button>
              </div>
            ))}
          </div>
          <div className="mt-10 border-l-2 border-primary pl-5 text-sm text-foreground/70">
            <p>
              Not every package is confirmed as its own installer. The buttons above lead to the current release on
              this page: a portable zip you unzip and open from Terminal.
            </p>
            <p className="mt-2">
              Some models and connected features may need an internet connection for initial setup or online use.{" "}
              <Link href="/agents" className="underline underline-offset-4">
                Browse agents
              </Link>{" "}
              before you choose a focus.
            </p>
          </div>
          <SetupGuide />
        </main>
      </SiteFrame>
      <PackDownload />
      <div className={`synap-site ${siteFontClass}`}>
        <SiteFooter />
      </div>
    </>
  );
}
