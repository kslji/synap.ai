"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, LogOut } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { AuthDialog } from "./AuthDialog";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { clearAccount, fetchProfile, type UserProfile } from "@/lib/account";
import { networkOnline } from "@/lib/net";
import { detectOs } from "@/lib/runtimeInstall";
import { assertModelCatalogIntegrity, buildManifest, oneCommand } from "@/lib/agentPacks";
import {
  RAM_TIERS,
  defaultModelForTier,
  modelsForTier,
  type RamTier,
} from "@/lib/localModelCatalog";
import { captureReferralFromUrl, trackEvent } from "@/lib/admin";

assertModelCatalogIntegrity();

/** synap.surf /download — one-screen: pick model → download → copy open command. */
export function ChatDownloadShell() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNext, setAuthNext] = useState<null | (() => void)>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [tier, setTier] = useState<RamTier>("light");
  const [modelId, setModelId] = useState(defaultModelForTier("light").id);
  const [copied, setCopied] = useState(false);
  const os = detectOs();

  const cmd = oneCommand(os);
  const tierModels = modelsForTier(tier);
  const selected = tierModels.find((m) => m.id === modelId) || defaultModelForTier(tier);

  useEffect(() => {
    captureReferralFromUrl();
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
    const lockedId = selected.id;
    const lockedTag = selected.tag;
    const lockedTier = selected.tier;
    void requireAccount(() => {
      setBusy(true);
      setNote("");
      try {
        const manifest = buildManifest("ollama", lockedTier, lockedId);
        if (manifest.model !== lockedTag || manifest.modelId !== lockedId) {
          throw new Error("Selected model did not lock into the pack. Try again.");
        }
        void trackEvent("download", `${manifest.agent}:${manifest.model}`);
        void downloadOnThisDevice({ manifest })
          .then(() => setNote(`Pack saved: ${manifest.modelTitle} (${manifest.model}). Unzip, then Copy → run.`))
          .catch((err) =>
            setNote(
              err instanceof Error
                ? err.message
                : "Download did not finish. Check your connection and try again.",
            ),
          )
          .finally(() => setBusy(false));
      } catch (err) {
        setBusy(false);
        setNote(err instanceof Error ? err.message : "Could not prepare this pack.");
      }
    });
  }

  async function copyCmd() {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setNote("Could not copy — select the command and copy it yourself.");
    }
  }

  return (
    <div className="landing download-shell">
      <div className="landing-atmosphere" aria-hidden />
      <header className="landing-top download-top">
        <Link href="/" className="brand">
          <BrandMark size={28} />
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
        <div className="download-head">
          <p className="download-kicker">Get local AI</p>
          <h1 className="download-brand">Download</h1>
          <p className="download-lede">Pick your laptop RAM, choose a model, then download the pack.</p>
        </div>

        <section className="download-section first" aria-labelledby="size-title">
          <h2 id="size-title">Your laptop</h2>
          <div className="tier-seg" role="radiogroup" aria-label="Computer size">
            {RAM_TIERS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={tier === t.id}
                className={tier === t.id ? "tier-seg-btn on" : "tier-seg-btn"}
                onClick={() => setTier(t.id)}
              >
                <span className="tier-label">{t.label}</span>
                <span className="tier-hint">{t.hint}</span>
              </button>
            ))}
          </div>

          <h2 className="download-models-title">Models</h2>
          <ul className="model-list">
            {tierModels.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={selected.id === m.id ? "model-card on" : "model-card"}
                  onClick={() => {
                    setModelId(m.id);
                    void trackEvent("model_click", m.tag);
                  }}
                >
                  <span className="model-card-top">
                    <strong>{m.title}</strong>
                    <span className="model-needs">
                      {m.download} · {m.ram}
                    </span>
                  </span>
                  <span className="model-about">{m.about}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="download-dock" aria-label="Download pack">
          <p className="selection-line">
            Selected: <strong>{selected.title}</strong> · {selected.download}
          </p>
          <button type="button" className="primary download-dock-btn" disabled={busy} onClick={startDownload}>
            <Download size={18} />
            {busy ? "Preparing pack…" : "Download pack"}
          </button>
          <div className="cmd-box download-dock-cmd">
            <code title={cmd}>{cmd}</code>
            <button type="button" className="ghost" onClick={() => void copyCmd()}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="download-hint">Unzip, then paste that command from any folder.</p>
          {note ? <p className="download-note">{note}</p> : null>
        </section>
      </main>

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
