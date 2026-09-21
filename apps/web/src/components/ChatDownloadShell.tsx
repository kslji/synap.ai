"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Download, LogOut } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { AuthDialog } from "./AuthDialog";
import { ChromeOnlyNotice } from "./ChromeOnlyNotice";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { clearAccount, fetchProfile, type UserProfile } from "@/lib/account";
import { networkOnline } from "@/lib/net";

/**
 * synap.surf /chat — download shell only. Real chat runs from the zip on the user's machine.
 */
export function ChatDownloadShell() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNext, setAuthNext] = useState<null | (() => void)>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void prefetchLocalPack();
    void fetchProfile()
      .then((p) => setProfile(p?.email_verified ? p : null))
      .catch(() => setProfile(null));
  }, []);

  async function requireAccount(then: () => void) {
    try {
      const me = await fetchProfile();
      if (me?.email_verified) {
        setProfile(me);
        then();
        return;
      }
    } catch {
      /* open auth */
    }
    if (!networkOnline()) {
      setAuthOpen(true);
      return;
    }
    setAuthNext(() => then);
    setAuthOpen(true);
  }

  function startDownload() {
    void requireAccount(() => {
      setBusy(true);
      setNote("");
      void downloadOnThisDevice()
        .then(() => setNote("Download started. Unzip, then run LOCAL-SETUP on your computer."))
        .catch(() =>
          setNote("Download did not finish. Stay on this page, check your connection, and try again."),
        )
        .finally(() => setBusy(false));
    });
  }

  return (
    <div className="landing download-shell">
      <header className="landing-top">
        <Link href="/" className="brand">
          <BrandMark size={36} />
          Surf AI
        </Link>
        {profile ? (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              clearAccount();
              setProfile(null);
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        ) : (
          <button type="button" className="ghost" onClick={() => setAuthOpen(true)}>
            Sign in
          </button>
        )}
      </header>

      <main className="landing-hero download-hero">
        <ChromeOnlyNotice />
        <p className="download-kicker">Private AI on your computer</p>
        <h1 className="download-brand">Surf AI</h1>
        <p className="lede">
          This site is only the door. Download the folder, run one setup step, and chat stays on the
          machine in front of you — not on our servers.
        </p>

        <div className="cta-row">
          <button type="button" className="primary" disabled={busy} onClick={startDownload}>
            <Download size={18} /> {busy ? "Preparing download…" : "Download for your computer"}
          </button>
        </div>

        <ol className="download-steps">
          <li>Unzip → open the <strong>local-ai</strong> folder</li>
          <li>
            Run <strong>LOCAL-SETUP</strong> (Mac/Linux: <code>bash LOCAL-SETUP.sh</code> · Windows:{" "}
            <code>LOCAL-SETUP.bat</code>)
          </li>
          <li>Chrome opens Surf on your computer. Leave that small window open while you chat.</li>
        </ol>

        <p className="tiny muted download-moss">
          When you are online and Moss keys are set in your local host <code>.env</code>, Surf uses Moss
          to find text in your files. If credits or keys fail, it switches to on-device keyword search
          automatically — no error wall.
        </p>

        {note ? <p className="download-note">{note}</p> : null}
      </main>

      <footer className="landing-foot">
        <Link href="/">Back to home</Link>
      </footer>

      <AuthDialog
        open={authOpen}
        onClose={() => {
          setAuthOpen(false);
          setAuthNext(null);
        }}
        onAuthed={() => {
          setAuthOpen(false);
          void fetchProfile()
            .then((p) => setProfile(p?.email_verified ? p : null))
            .catch(() => undefined);
          authNext?.();
          setAuthNext(null);
        }}
      />
    </div>
  );
}
