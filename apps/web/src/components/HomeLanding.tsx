"use client";

import { useState } from "react";
import { Download, Terminal, Waves } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { downloadOnThisDevice } from "@/lib/openOnDevice";
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
  "Try local Surf: attach a folder or a photo and get an answer from you personal computer. Nothing is sent to internet.";
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
  const [pending, setPending] = useState<null | (() => void)>(null);

  async function gated(fn: () => void) {
    if (!networkOnline()) {
      fn();
      return;
    }
    const me = await fetchProfile();
    if (me?.email_verified) {
      fn();
      return;
    }
    setPending(() => fn);
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
          stayLabel="Continue offline chat"
          onStay={() => router.push("/chat")}
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
                <Waves size={18} /> Try local Surf
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void gated(() => void downloadOnThisDevice())}
              >
                <Download size={16} /> Download to run offline
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
        allowSkip
        onClose={() => setAuthOpen(false)}
        onAuthed={() => {
          setAuthOpen(false);
          pending?.();
          setPending(null);
        }}
      />
    </div>
  );
}
