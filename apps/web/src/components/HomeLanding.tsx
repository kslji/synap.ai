"use client";

import { useState } from "react";
import { Download, Terminal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchProfile } from "@/lib/account";
import { networkOnline } from "@/lib/net";
import { AuthDialog } from "./AuthDialog";
import { LocalSetupDialog } from "./LocalSetupDialog";
import { OfflineBanner } from "./OfflineBanner";
import { BrandMark } from "./BrandMark";
import { LandingTypeCycle } from "./TypeCopy";

const HEADLINES = [
  "Surf your files locally. Synap data instantly.",
  "Your private agent buddy work across your files and system.",
  "One zip. One command. An agent buddy on your desk.",
  "Open the pack. Shape your agent buddy for your platform.",
] as const;
const LEDE = "A private agent buddy on your machine to follow your commands download once, chat offline.";
const POINTS = [
  "Your files stay on your desk. No cloud customs for your folders.",
  "When Wi‑Fi drops, your agent buddy doesn’t. Keep going on this computer.",
  "One zip. One command. Local chat opens for you.",
  "Open the pack and change the code — tune your agent buddy for your platform.",
] as const;

export function HomeLanding() {
  const router = useRouter();
  const [setupOpen, setSetupOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNext, setAuthNext] = useState<null | (() => void)>(null);

  async function gated(fn: () => void) {
    try {
      const me = await fetchProfile();
      if (me?.email_verified) {
        fn();
        return;
      }
    } catch {
      /* open auth */
    }
    if (!networkOnline()) {
      setAuthOpen(true);
      return;
    }
    setAuthNext(() => fn);
    setAuthOpen(true);
  }

  return (
    <div className="landing">
      <div className="landing-atmosphere" aria-hidden />
      <header className="landing-top">
        <div>
          <Link href="/" className="brand">
            <BrandMark size={36} />
            Surf AI
          </Link>
        </div>
        <div className="landing-top-actions">
          <Link href="/download" className="ghost linkish">
            Download
          </Link>
          <button type="button" className="ghost" onClick={() => setSetupOpen(true)}>
            <Terminal size={16} /> Setup
          </button>
        </div>
      </header>

      <main className="landing-hero">
        <OfflineBanner
          stayLabel="Get the download zip"
          onStay={() => void gated(() => router.push("/download"))}
        />
        <LandingTypeCycle
          headlines={HEADLINES}
          lede={LEDE}
          points={POINTS}
          holdMs={3_000}
          middle={
            <div className="cta-row">
              <button
                type="button"
                className="primary"
                onClick={() => void gated(() => router.push("/download"))}
              >
                <Download size={18} /> Download pack
              </button>
              <button type="button" className="ghost" onClick={() => setSetupOpen(true)}>
                Setup steps
              </button>
            </div>
          }
        />
      </main>
      <footer className="landing-foot">
        Builder —{" "}
        <a
          href="https://www.linkedin.com/in/kabir-singh-lamba-datawizard/"
          target="_blank"
          rel="noreferrer"
        >
          Kabir Singh Lamba
        </a>
      </footer>
      <LocalSetupDialog open={setupOpen} onClose={() => setSetupOpen(false)} />
      <AuthDialog
        open={authOpen}
        onClose={() => {
          setAuthOpen(false);
          setAuthNext(null);
        }}
        onAuthed={() => {
          setAuthOpen(false);
          authNext?.();
          setAuthNext(null);
        }}
      />
    </div>
  );
}
