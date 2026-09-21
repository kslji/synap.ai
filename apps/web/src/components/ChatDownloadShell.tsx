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
import {
  AGENT_PACKS,
  buildManifest,
  oneCommand,
  packById,
  type AgentId,
} from "@/lib/agentPacks";
import {
  RAM_TIERS,
  defaultModelForTier,
  modelsForTier,
  type RamTier,
} from "@/lib/localModelCatalog";
import { captureReferralFromUrl, trackEvent } from "@/lib/admin";

/** synap.surf /download — pick agent + model, one LOCAL-SETUP → localhost chat. */
export function ChatDownloadShell() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNext, setAuthNext] = useState<null | (() => void)>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [agent, setAgent] = useState<AgentId>("ollama");
  const [tier, setTier] = useState<RamTier>("light");
  const [modelId, setModelId] = useState(defaultModelForTier("light").id);
  const [copied, setCopied] = useState(false);
  const os = detectOs();

  const pack = packById(agent);
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
    void requireAccount(() => {
      setBusy(true);
      setNote("");
      const manifest = buildManifest(agent, tier, selected.tag);
      void trackEvent("download", `${manifest.agent}:${manifest.model}`);
      void downloadOnThisDevice({ manifest })
        .then(() =>
          setNote("Pack saved. Unzip it, then use the Copy button above to run the open command."),
        )
        .catch(() =>
          setNote("Download did not finish. Check your connection and try again."),
        )
        .finally(() => setBusy(false));
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
        <p className="download-kicker">Get local AI</p>
        <h1 className="download-brand">Download</h1>

        <section className="download-section first" aria-label="Agents">
          <div className="agent-grid">
            {AGENT_PACKS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={agent === p.id ? "agent-tile on" : "agent-tile"}
                onClick={() => {
                  setAgent(p.id);
                  void trackEvent("agent_click", p.id);
                }}
              >
                <span className="agent-tile-title">{p.title}</span>
                <span className="agent-tile-meta">{p.license}</span>
                <span className="agent-tile-hint">{p.downloadHint}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="download-section" aria-labelledby="size-title">
          <h2 id="size-title">Models for 1–8 GB RAM</h2>
          <p className="selection-line">
            Pick your laptop size, then a model. Heavier packs stay off for now.
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
                  onClick={() => {
                    setModelId(m.id);
                    void trackEvent("model_click", m.tag);
                  }}
                >
                  <strong>{m.title}</strong>
                  <span className="model-needs">
                    {m.download} · {m.ram}
                  </span>
                  <span className="model-about">
                    <strong>{m.forWho}</strong> — {m.about}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="download-section download-cta-block" aria-labelledby="dl-title">
          <h2 id="dl-title">Get the zip</h2>
          <p className="selection-line">
            {pack.title} · {selected.title} · {selected.download}
          </p>
          <div className="cta-row">
            <button type="button" className="primary" disabled={busy} onClick={startDownload}>
              <Download size={18} />
              {busy ? "Preparing pack…" : "Download pack"}
            </button>
          </div>
          <ol className="download-steps">
            <li>Unzip</li>
            <li>
              Run from any directory (lists every downloaded pack)
              <div className="cmd-box">
                <code>{cmd}</code>
                <button type="button" className="ghost" onClick={() => void copyCmd()}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </li>
          </ol>
        </section>

        {note ? <p className="download-note">{note}</p> : null}
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
