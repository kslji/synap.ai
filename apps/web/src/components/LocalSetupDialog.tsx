"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import Link from "next/link";
import { detectOs, isMobileBrowser } from "@/lib/runtimeInstall";
import { downloadOnThisDevice } from "@/lib/openOnDevice";
import { RUN_SETUP_UNIX, RUN_SETUP_WIN } from "@/lib/setupCommands";

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function LocalSetupDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [os, setOs] = useState<"mac" | "win" | "linux">("mac");
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOs(detectOs());
    setMobile(isMobileBrowser());
  }, []);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const cmd = os === "win" ? RUN_SETUP_WIN : RUN_SETUP_UNIX;
  const terminal =
    os === "win"
      ? "Open Command Prompt (Start → type cmd)."
      : "Open Terminal (Command + Space, type Terminal).";

  return (
    <div className="setup-scrim" role="presentation" onClick={onClose}>
      <div
        className="setup-panel"
        role="dialog"
        aria-labelledby="setup-title"
        onClick={(e) => e.stopPropagation()}
      >
        {mobile ? (
          <>
            <h2 id="setup-title">On a phone or tablet</h2>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
              Open this in <strong>Google Chrome</strong> only. Phones cannot run the local zip setup
              (no Terminal). Use a Mac, Windows, or Linux computer to download and chat privately.
            </p>
            <ol className="setup-steps">
              <li>
                On a computer, open{" "}
                <Link href="/chat" onClick={onClose}>
                  Download
                </Link>{" "}
                and save the zip.
              </li>
              <li>
                Unzip, run <strong>LOCAL-SETUP</strong>, and chat opens on that machine — not in this
                phone browser.
              </li>
            </ol>
            <p className="tiny muted">
              Answers stay on the computer that runs the zip. This website only hands you the download.
            </p>
          </>
        ) : (
          <>
            <h2 id="setup-title">Use Surf AI on this computer</h2>
            <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
              Open this in <strong>Google Chrome</strong> only. Download the folder, then run one
              command — Chrome opens on its own.
            </p>
            <ol className="setup-steps">
              <li>
                Save the folder to this computer.
                <button
                  type="button"
                  className="primary wide"
                  style={{ margin: "10px 0 4px" }}
                  disabled={busy}
                  onClick={() => {
                    setErr("");
                    setBusy(true);
                    void downloadOnThisDevice()
                      .catch(() =>
                        setErr("Download did not finish. Check your connection and try again."),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  <Download size={16} /> {busy ? "Preparing download…" : "Download Surf AI"}
                </button>
              </li>
              <li>
                Find the zip in Downloads and double-click it to unpack. You should get a folder named{" "}
                <strong>local-ai</strong>.
              </li>
              <li>
                {terminal} Copy and paste this one line, then press Return. Chrome will open for you:
                <pre className="setup-cmd">{cmd}</pre>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    void copy(cmd).then((ok) => {
                      if (!ok) return;
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 2000);
                    });
                  }}
                >
                  {copied ? "Copied" : "Copy this command"}
                </button>
              </li>
            </ol>
            {err ? <p className="warn">{err}</p> : null}
            <p className="tiny muted">
              Leave the small window that appears open while you chat. Close that window when you
              are finished.
            </p>
            <p className="tiny muted">
              Install{" "}
              <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
                Google Chrome
              </a>{" "}
              if you do not have it yet. Answers stay on this computer. Phones cannot run this zip —
              download from a desktop instead.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
