"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, LogOut } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { AuthDialog } from "./AuthDialog";
import { ChromeOnlyNotice } from "./ChromeOnlyNotice";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { clearAccount, fetchProfile, type UserProfile } from "@/lib/account";
import { networkOnline } from "@/lib/net";
import { detectOs } from "@/lib/runtimeInstall";
import {
  COLIBRI_BLURB,
  COLIBRI_INSTALL_UNIX,
  COLIBRI_INSTALL_WIN,
  COLIBRI_REPO,
  RAM_TIERS,
  defaultModelForTier,
  modelsForTier,
  ollamaInstallHint,
  type OllamaModelOption,
  type RamTier,
} from "@/lib/localModelCatalog";

/**
 * synap.surf /chat — download shell only. Real chat runs from the zip on the user's machine.
 */
export function ChatDownloadShell() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNext, setAuthNext] = useState<null | (() => void)>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [tier, setTier] = useState<RamTier>("everyday");
  const [modelId, setModelId] = useState(defaultModelForTier("everyday").id);
  const [copied, setCopied] = useState<string | null>(null);
  const os = detectOs();

  const tierModels = modelsForTier(tier);
  const selected: OllamaModelOption =
    tierModels.find((m) => m.id === modelId) || defaultModelForTier(tier);
  const colibriCmd = os === "win" ? COLIBRI_INSTALL_WIN : COLIBRI_INSTALL_UNIX;

  useEffect(() => {
    void prefetchLocalPack();
    void fetchProfile()
      .then((p) => setProfile(p?.email_verified ? p : null))
      .catch(() => setProfile(null));
  }, []);

  useEffect(() => {
    setModelId(defaultModelForTier(tier).id);
  }, [tier]);

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
        .then(() =>
          setNote(
            "Download started. Unzip → LOCAL-SETUP → pull a model (commands below) → chat on your computer.",
          ),
        )
        .catch(() =>
          setNote("Download did not finish. Stay on this page, check your connection, and try again."),
        )
        .finally(() => setBusy(false));
    });
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setNote("Could not copy. Select the command and copy it yourself.");
    }
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
          This site is only the door. Download the folder, pick a model that fits your computer, and
          chat stays on the machine in front of you.
        </p>

        <div className="cta-row">
          <button type="button" className="primary" disabled={busy} onClick={startDownload}>
            <Download size={18} /> {busy ? "Preparing download…" : "1 · Download Surf"}
          </button>
        </div>

        <ol className="download-steps">
          <li>Unzip → open the <strong>local-ai</strong> folder</li>
          <li>
            Run <strong>LOCAL-SETUP</strong>, then pull a model (step 2 below)
          </li>
          <li>Optional: Colibri as a second local agent (step 3)</li>
        </ol>

        <section className="download-section" aria-labelledby="models-title">
          <h2 id="models-title">2 · Download a model for your computer</h2>
          <p className="tiny muted">
            Install{" "}
            <a href="https://ollama.com" target="_blank" rel="noreferrer">
              Ollama
            </a>{" "}
            once ({ollamaInstallHint(os)}). Pick your machine size, then copy the pull command.
            Needs internet once; after that the model works offline.
          </p>

          <div className="tier-row" role="radiogroup" aria-label="Computer size">
            {RAM_TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tier === t.id}
                className={tier === t.id ? "tier-chip on" : "tier-chip"}
                onClick={() => setTier(t.id)}
              >
                <span className="tier-label">{t.label}</span>
                <span className="tier-hint">{t.hint}</span>
              </button>
            ))}
          </div>

          <ul className="model-list">
            {tierModels.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={selected.id === m.id ? "model-card on" : "model-card"}
                  onClick={() => setModelId(m.id)}
                >
                  <strong>{m.title}</strong>
                  <span className="model-needs">{m.needs}</span>
                  <span className="model-about">{m.about}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="cmd-box">
            <code>{selected.pull}</code>
            <button
              type="button"
              className="ghost"
              onClick={() => void copyText("pull", selected.pull)}
            >
              {copied === "pull" ? <Check size={16} /> : <Copy size={16} />}
              {copied === "pull" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="tiny muted">
            Or from the unzipped folder: <code>bash PULL-MODEL.sh {selected.tag}</code> (Windows:{" "}
            <code>PULL-MODEL.bat {selected.tag}</code>).
          </p>
        </section>

        <section className="download-section" aria-labelledby="colibri-title">
          <h2 id="colibri-title">3 · Optional · Colibri agent</h2>
          <p className="tiny muted">{COLIBRI_BLURB}</p>
          <p className="tiny muted">
            Source:{" "}
            <a href={COLIBRI_REPO} target="_blank" rel="noreferrer">
              github.com/JustVugg/colibri
            </a>
            . One command clones and builds. Serve on port 8000; Surf’s local host will use it when
            Ollama is not running.
          </p>
          <div className="cmd-box">
            <code className="cmd-long">{colibriCmd}</code>
            <button
              type="button"
              className="ghost"
              onClick={() => void copyText("coli", colibriCmd)}
            >
              {copied === "coli" ? <Check size={16} /> : <Copy size={16} />}
              {copied === "coli" ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="tiny muted">
            Zip also includes <code>INSTALL-COLIBRI.sh</code> / <code>INSTALL-COLIBRI.bat</code>.
            Online for first clone and model download; offline afterward with the model already on
            disk.
          </p>
        </section>

        <p className="tiny muted download-moss">
          When you are online and Moss keys are set in your local host <code>.env</code>, Surf uses
          Moss to find text in your files. If credits or keys fail, it switches to on-device keyword
          search automatically.
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
