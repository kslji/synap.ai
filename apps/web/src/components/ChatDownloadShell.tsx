"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, LogOut } from "lucide-react";
import { BrandMark } from "./BrandMark";
import { AuthDialog } from "./AuthDialog";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { clearAccount, fetchProfile, type UserProfile } from "@/lib/account";
import { networkOnline } from "@/lib/net";
import { detectOs, isMobileBrowser } from "@/lib/runtimeInstall";
import { assertModelCatalogIntegrity, buildManifest, oneCommand } from "@/lib/agentPacks";
import { runCustomHarnessCommand, runEvalsCommand } from "@/lib/setupCommands";
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
  const [copied, setCopied] = useState<"open" | "evals" | "custom" | null>(null);
  const [mobile, setMobile] = useState(false);
  const os = detectOs();

  const cmd = oneCommand(os);
  const evalsCmd = runEvalsCommand(os);
  const customCmd = runCustomHarnessCommand(os);
  const tierModels = modelsForTier(tier);
  const selected = tierModels.find((m) => m.id === modelId) || defaultModelForTier(tier);

  useEffect(() => {
    setMobile(isMobileBrowser());
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
    if (isMobileBrowser()) {
      setNote("Use a Mac, Windows, or Linux laptop — phones and tablets can’t run Terminal setup.");
      return;
    }
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

  async function copyText(text: string, which: "open" | "evals" | "custom") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1800);
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
          <p className="download-lede">
            Pick RAM and a model. <strong>Moss</strong> ={" "}
            <strong>text document retrieval</strong>, then your local model answers.
          </p>
        </div>

        <section className="download-section first" aria-label="Pick laptop size and model">
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

          <ul className="model-list" aria-label="Models">
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
                      {m.download.replace(" to download", "")} · {m.ram.replace("Fits ", "")}
                    </span>
                  </span>
                  <span className="model-about">{m.about}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="download-dock" aria-label="Download pack">
          <button
            type="button"
            className="primary download-dock-btn"
            disabled={busy || mobile}
            onClick={startDownload}
          >
            <Download size={16} />
            {busy
              ? "Preparing pack…"
              : mobile
                ? "Open on a laptop"
                : `Download ${selected.title}`}
          </button>
          <div className="download-run-required" aria-label="Required open command">
            <p className="download-run-label">
              <span className="download-run-badge">Required</span>
              Unzip, then run this in Terminal
            </p>
            <div className="cmd-box download-dock-cmd download-dock-cmd-required">
              <code title={cmd}>{cmd}</code>
              <button
                type="button"
                className="primary download-copy-required"
                onClick={() => void copyText(cmd, "open")}
                disabled={mobile}
              >
                {copied === "open" ? <Check size={14} /> : <Copy size={14} />}
                {copied === "open" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          {!mobile ? (
            <div className="download-optional" aria-label="Optional harness checks">
              <p className="download-optional-label">Optional — verify harness</p>
              <div className="download-optional-cmds">
                <div className="download-optional-row">
                  <span className="cmd-tag">evals</span>
                  <div className="cmd-box download-dock-cmd download-dock-cmd-optional">
                    <code title={evalsCmd}>{evalsCmd}</code>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void copyText(evalsCmd, "evals")}
                    >
                      {copied === "evals" ? <Check size={14} /> : <Copy size={14} />}
                      {copied === "evals" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
                <div className="download-optional-row">
                  <span className="cmd-tag">custom</span>
                  <div className="cmd-box download-dock-cmd download-dock-cmd-optional">
                    <code title={customCmd}>{customCmd}</code>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => void copyText(customCmd, "custom")}
                    >
                      {copied === "custom" ? <Check size={14} /> : <Copy size={14} />}
                      {copied === "custom" ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="download-hint">
              Phones and tablets aren’t supported — use a computer with Terminal.
            </p>
          )}
          {note ? <p className="download-note">{note}</p> : null}
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
