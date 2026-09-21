"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, LogOut } from "lucide-react";
import { BrandMark } from "./BrandMark";
import {
  adminLogin,
  fetchAdminMe,
  fetchAdminStats,
  getAdminToken,
  setAdminToken,
  type AdminStats,
} from "@/lib/admin";

export function AdminConsole() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [authedEmail, setAuthedEmail] = useState("");
  const [referralPath, setReferralPath] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const me = await fetchAdminMe();
    setAuthedEmail(me.email);
    setReferralCode(me.referral_code);
    setReferralPath(me.referral_path);
    setStats(await fetchAdminStats());
  }, []);

  useEffect(() => {
    if (!getAdminToken()) return;
    void load().catch(() => setAdminToken(null));
  }, [load]);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const data = await adminLogin(email.trim(), password);
      setAuthedEmail(data.email);
      setReferralCode(data.referral_code);
      setReferralPath(data.referral_path);
      setStats(await fetchAdminStats());
      setPassword("");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setAdminToken(null);
    setAuthedEmail("");
    setStats(null);
    setReferralPath("");
    setReferralCode("");
  }

  async function copyRef() {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://synap.surf";
    const url = `${origin}${referralPath || `/download?ref=${referralCode}`}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setErr("Could not copy link");
    }
  }

  const refUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${referralPath || `/download?ref=${referralCode}`}`
      : referralPath;

  return (
    <div className="landing download-shell">
      <div className="landing-atmosphere" aria-hidden />
      <header className="landing-top">
        <Link href="/" className="brand">
          <BrandMark size={36} />
          Surf AI
        </Link>
        {authedEmail ? (
          <button type="button" className="ghost" onClick={signOut}>
            <LogOut size={16} /> Sign out
          </button>
        ) : (
          <Link href="/download" className="ghost linkish">
            Download
          </Link>
        )}
      </header>

      <main className="landing-hero download-hero admin-hero">
        <p className="download-kicker">Operator</p>
        <h1 className="download-brand">Admin</h1>

        {!authedEmail ? (
          <form className="admin-login" onSubmit={(e) => void onLogin(e)}>
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {err ? <p className="warn">{err}</p> : null}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
          <>
            <p className="selection-line">Signed in as {authedEmail}</p>

            <section className="download-section first">
              <h2>Your referral link</h2>
              <div className="cmd-box">
                <code>{refUrl}</code>
                <button type="button" className="ghost" onClick={() => void copyRef()}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Share this link. New accounts that register after opening it count under your code{" "}
                <strong>{referralCode}</strong>.
              </p>
            </section>

            {stats ? (
              <>
                <section className="download-section">
                  <h2>Accounts</h2>
                  <div className="admin-stat-grid">
                    <div className="admin-stat">
                      <strong>{stats.totals.users}</strong>
                      <span>Total signups</span>
                    </div>
                    <div className="admin-stat">
                      <strong>{stats.totals.verified}</strong>
                      <span>Verified</span>
                    </div>
                    <div className="admin-stat">
                      <strong>{stats.totals.logins}</strong>
                      <span>Logins</span>
                    </div>
                    <div className="admin-stat">
                      <strong>{stats.totals.signups}</strong>
                      <span>Signup events</span>
                    </div>
                  </div>
                </section>

                <section className="download-section">
                  <h2>Models (most clicks)</h2>
                  {stats.models.length === 0 ? (
                    <p className="tiny muted">No model clicks yet.</p>
                  ) : (
                    <ul className="admin-rank">
                      {stats.models.map((m) => (
                        <li key={m.label}>
                          <span>{m.label}</span>
                          <strong>{m.clicks}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="download-section">
                  <h2>Agents</h2>
                  {stats.agents.length === 0 ? (
                    <p className="tiny muted">No agent clicks yet.</p>
                  ) : (
                    <ul className="admin-rank">
                      {stats.agents.map((m) => (
                        <li key={m.label}>
                          <span>{m.label}</span>
                          <strong>{m.clicks}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="download-section">
                  <h2>Downloads</h2>
                  {stats.downloads.length === 0 ? (
                    <p className="tiny muted">No downloads tracked yet.</p>
                  ) : (
                    <ul className="admin-rank">
                      {stats.downloads.map((m) => (
                        <li key={m.label}>
                          <span>{m.label}</span>
                          <strong>{m.clicks}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="download-section">
                  <h2>Referrals by code</h2>
                  {stats.referrals.length === 0 ? (
                    <p className="tiny muted">No referred signups yet.</p>
                  ) : (
                    <ul className="admin-rank">
                      {stats.referrals.map((r) => (
                        <li key={r.code}>
                          <span>{r.code}</span>
                          <strong>{r.users}</strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="download-section">
                  <h2>Recent users</h2>
                  <ul className="admin-users">
                    {stats.recent_users.map((u) => (
                      <li key={`${u.email}-${u.created_at}`}>
                        <span>{u.email}</span>
                        <span className="tiny muted">
                          {u.email_verified ? "verified" : "pending"}
                          {u.referred_by ? ` · ref ${u.referred_by}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : null}
            {err ? <p className="warn">{err}</p> : null}
          </>
        )}
      </main>
    </div>
  );
}
