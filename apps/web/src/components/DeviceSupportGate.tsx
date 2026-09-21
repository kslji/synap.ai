"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isMobileBrowser } from "@/lib/runtimeInstall";

const DISMISS_KEY = "surf.ai.device-gate.dismissed";

/**
 * Phones/tablets have no Terminal for LOCAL-SETUP / SURF-OPEN.
 * Show a clear gate so users know only laptop/desktop is supported for the pack.
 */
export function DeviceSupportGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isMobileBrowser()) return;
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setOpen(true);
  }, []);

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div className="setup-scrim device-gate-scrim" role="presentation">
      <div
        className="setup-panel device-gate-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-gate-title"
      >
        <h2 id="device-gate-title">Laptop or desktop required</h2>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
          Surf AI runs from a download pack that needs a <strong>Terminal</strong> (Mac, Windows,
          or Linux). Phones and tablets can’t run that setup.
        </p>
        <ul className="device-gate-list">
          <li>
            <strong>Supported:</strong> Mac, Windows, or Linux computer with Terminal / Command Prompt
          </li>
          <li>
            <strong>Not supported:</strong> iPhone, Android, iPad, and other mobile browsers
          </li>
        </ul>
        <p className="tiny muted" style={{ margin: "0 0 14px", lineHeight: 1.5 }}>
          Open <Link href="/download">synap.surf/download</Link> on a laptop, download the zip, unzip,
          then run the one command — chat stays on that machine.
        </p>
        <div className="device-gate-actions">
          <button type="button" className="primary" onClick={dismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
