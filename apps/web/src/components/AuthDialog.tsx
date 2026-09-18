"use client";

import { useState } from "react";
import { networkOnline } from "@/lib/net";
import {
  fetchProfile,
  forgotPassword,
  loginAccount,
  registerAccount,
  resendOtp,
  resetPassword,
  verifyEmail,
  type UserProfile,
} from "@/lib/account";

type Mode = "register" | "login" | "verify" | "forgot" | "reset";

function copyFor(mode: Mode): string {
  if (mode === "register") {
    return "Create an account with your email and a password (at least 8 characters). We email a 6-digit code so we know the address is yours.";
  }
  if (mode === "login") {
    return "Sign in with the same email and password you used to register.";
  }
  if (mode === "verify") {
    return "Enter the 6-digit code from your email. It expires in 10 minutes. Mail is sent by the Python host (smtplib), not Node/Nodemailer. If nothing arrives, this computer has no SMTP settings — the code is also saved in mail-outbox.jsonl on the host.";
  }
  if (mode === "forgot") {
    return "We’ll email a 6-digit reset code to this address if an account exists.";
  }
  return "Enter the 6-digit reset code from email, then choose a new password (at least 8 characters).";
}

export function AuthDialog({
  open,
  onClose,
  onAuthed,
  allowSkip = false,
}: {
  open: boolean;
  onClose: () => void;
  onAuthed: (user: UserProfile) => void;
  allowSkip?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");

  if (!open) return null;

  async function done(user: UserProfile) {
    onAuthed(user);
  }

  async function submit() {
    setBusy(true);
    setErr("");
    setHint("");
    try {
      if (!networkOnline()) {
        setErr("Internet is off. Sign-in is stored on our backend and will send when you are online. Meanwhile you can wait, or chat with attached files.");
        return;
      }
      const needsPassword = mode === "register" || mode === "login" || mode === "reset";
      if (!email.trim()) {
        setErr("Enter your email address.");
        return;
      }
      if (needsPassword && password.length < 8) {
        setErr("Password must be at least 8 characters.");
        return;
      }
      if ((mode === "verify" || mode === "reset") && otp.trim().length < 4) {
        setErr("Enter the 6-digit code from your email.");
        return;
      }
      if (mode === "register") {
        await registerAccount(email, password);
        setMode("verify");
        setHint("Check your inbox for a 6-digit code, then paste it below.");
      } else if (mode === "verify") {
        await done(await verifyEmail(email, otp));
      } else if (mode === "login") {
        await done(await loginAccount(email, password));
      } else if (mode === "forgot") {
        await forgotPassword(email);
        setMode("reset");
        setHint("If that email has an account, we sent a reset code. Check your inbox.");
      } else {
        await done(await resetPassword(email, otp, password));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not continue.";
      setErr(msg);
      if (/Verify your email/i.test(msg)) setMode("verify");
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "register"
      ? "Create an account"
      : mode === "login"
        ? "Sign in"
        : mode === "verify"
          ? "Enter the email code"
          : mode === "forgot"
            ? "Forgot password"
            : "Choose a new password";

  return (
    <div className="setup-scrim" role="presentation" onClick={allowSkip ? onClose : undefined}>
      <div className="setup-panel" role="dialog" aria-labelledby="auth-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="auth-title">{title}</h2>
        {!networkOnline() && (
          <p className="warn">
            Internet is off. Accounts and thumbs live on our backend, not on this computer. Please
            wait until you are online, or close this and chat with attached files.
          </p>
        )}
        <p className="muted">{copyFor(mode)}</p>
        <label className="tiny muted" htmlFor="auth-email">
          Email
        </label>
        <input
          id="auth-email"
          className="auth-input"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {mode !== "verify" && mode !== "forgot" && (
          <>
            <label className="tiny muted" htmlFor="auth-pass">
              Password (at least 8 characters)
            </label>
            <input
              id="auth-pass"
              className="auth-input"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </>
        )}
        {(mode === "verify" || mode === "reset") && (
          <>
            <label className="tiny muted" htmlFor="auth-otp">
              6-digit code from email
            </label>
            <input
              id="auth-otp"
              className="auth-input"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="123456"
            />
          </>
        )}
        {hint && <p className="tiny muted">{hint}</p>}
        {err && <p className="warn">{err}</p>}
        <button type="button" className="primary wide" disabled={busy} onClick={() => void submit()}>
          {mode === "register"
            ? "Send verification code"
            : mode === "login"
              ? "Sign in"
              : mode === "verify"
                ? "Confirm email"
                : mode === "forgot"
                  ? "Send reset code"
                  : "Save password and sign in"}
        </button>
        {(mode === "verify" || mode === "reset") && (
          <button
            type="button"
            className="ghost wide"
            disabled={busy}
            onClick={() =>
              void resendOtp(email, mode === "reset" ? "reset" : "verify")
                .then(() => setHint("We sent another code to that email."))
                .catch((e) => setErr(e instanceof Error ? e.message : "Could not resend."))
            }
          >
            Send a new code
          </button>
        )}
        <p className="tiny muted">
          {mode === "register" ? (
            <button type="button" className="linkish" onClick={() => setMode("login")}>
              Already have an account? Sign in
            </button>
          ) : mode === "login" ? (
            <>
              <button type="button" className="linkish" onClick={() => setMode("register")}>
                Create an account
              </button>
              {" · "}
              <button type="button" className="linkish" onClick={() => setMode("forgot")}>
                Forgot password
              </button>
            </>
          ) : (
            <button type="button" className="linkish" onClick={() => setMode("login")}>
              Back to sign in
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

export async function requireProfile(): Promise<UserProfile | null> {
  return fetchProfile();
}
