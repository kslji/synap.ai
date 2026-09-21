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

/**
 * synap.surf /chat — pick agent + model, download zip, run one LOCAL-SETUP → localhost chat.
 */
export function ChatDownloadShell() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNext, setAuthNext] = useState<null | (() => void)>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [agent, setAgent] = useState<AgentId>("surf");
  const [tier, setTier] = useState<RamTier>("everyday");
  const [modelId, setModelId] = useState(defaultModelForTier("everyday").id);
  const [copied, setCopied] = useState(false);
  const os = detectOs();

  const pack = packById(agent);
  const cmd = oneCommand(os);
  const tierModels = modelsForTier(tier);
  const selected = tierModels.find((m) => m.id === modelId) || defaultModelForTier(tier);

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
      const manifest = buildManifest(agent, tier, selected.tag);
      void downloadOnThisDevice({ manifest })
        .then(() =>
          setNote(
            `Downloaded ${pack.zipName}. Unzip, then run only: ${cmd} — Chrome opens chat on this computer.`,
          ),
        )
        .catch(() =>
          setNote("Download did not finish. Stay on this page, check your connection, and try again."),
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
      setNote("Could not copy. Type the command from the box below.");
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
          Pick an agent and a model size. Download the zip. Run <strong>one</strong> command. Chrome
          opens chat on <strong>localhost</strong> — same steps for every agent.
        </p>

        <section className="download-section" aria-labelledby="agent-title" style={{ marginTop: 20, paddingTop: 0, borderTop: "none" }}>
          <h2 id="agent-title">1 · Choose your agent</h2>
          <ul className="model-list">
            {AGENT_PACKS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={agent === p.id ? "model-card on" : "model-card"}
                  onClick={() => setAgent(p.id)}
                >
                  <strong>{p.title}</strong>
                  <span className="model-needs">{p.license}</span>
                  <span className="model-about">{p.blurb}</span>
                  <span className="model-about">{p.downloadHint}</span>
                  <span className="model-about">
                    After setup: {p.opens}. {p.offlineNote}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="download-section" aria-labelledby="size-title">
          <h2 id="size-title">2 · Choose a model for your computer</h2>
          <p className="tiny muted">
            The zip itself is small. The AI model is a separate download (shown on each card). We pull
            it automatically when you run the one setup command — you do not run a second command.
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

        <section className="download-section" aria-labelledby="dl-title">
          <h2 id="dl-title">3 · Download &amp; run one command</h2>
          <p className="tiny muted">
            Selected: <strong>{pack.title}</strong> · <strong>{selected.title}</strong> (
            {selected.download})
          </p>
          <div className="cta-row">
            <button type="button" className="primary" disabled={busy} onClick={startDownload}>
              <Download size={18} /> {busy ? "Preparing zip…" : `Download ${pack.zipName}`}
            </button>
          </div>
          <ol className="download-steps">
            <li>Unzip the folder</li>
            <li>
              Run only this (Mac/Linux or Windows):
              <div className="cmd-box" style={{ marginTop: 10 }}>
                <code>{cmd}</code>
                <button type="button" className="ghost" onClick={() => void copyCmd()}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </li>
            <li>
              Chrome opens <code>http://127.0.0.1:18766</code> — start chatting. Leave the small
              terminal window open.
            </li>
          </ol>
          <p className="tiny muted download-moss">
            Same single command for Surf, GPT4All, Jan, and AnythingLLM. First run may need internet
            for the engine and model; afterward it works offline. Partner names keep their licenses
            (MIT / AGPL); chat always opens in your local browser.
          </p>
        </section>

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
