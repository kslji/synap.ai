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
import { ChromeOnlyNotice } from "./ChromeOnlyNotice";
import { LandingTypeCycle } from "./TypeCopy";

const HEADLINE = "Surf your files locally. Synap data instantly.";
const LEDE =
  "Download Surf to your computer. Attach a folder or file and get answers from your machine — nothing is sent to the internet for chat.";
const POINTS = [
  "Surf is that spark between you and what’s already on your desk.",
  "Ride the machine in front of you - no passport for your folders, no customs in the cloud.",
  "When the wifi goes out, the wave doesn’t. Keep surfing the same tide pool.",
  "Come back tomorrow and your board is still on this shore, not rented from someone else’s beach.",
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
      <header className="landing-top">
        <div>
          <Link href="/" className="brand">
            <BrandMark size={36} />
            Surf AI
          </Link>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => setSetupOpen(true)}
        >
          <Terminal size={16} /> Setup steps
        </button>
      </header>

      <main className="landing-hero">
        <OfflineBanner
          stayLabel="Get the download zip"
          onStay={() => void gated(() => router.push("/chat"))}
        />
        <ChromeOnlyNotice />
        <LandingTypeCycle
          headline={HEADLINE}
          lede={LEDE}
          points={POINTS}
          holdMs={10_000}
          middle={
            <div className="cta-row">
              <button
                type="button"
                className="primary"
                onClick={() => void gated(() => router.push("/chat"))}
              >
                <Download size={18} /> Download Surf for your computer
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
