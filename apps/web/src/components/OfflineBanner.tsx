"use client";

import { Download, MessageSquare, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { networkOnline } from "@/lib/net";

/**
 * Offline chooser: slim status under the chat header (not a huge card in the thread).
 * First time offline → compact dialog; after Continue → thin status strip.
 */
export function OfflineBanner({
  extra,
  stayLabel = "Continue offline chat",
  onStay,
}: {
  extra?: string;
  stayLabel?: string;
  onStay?: () => void;
  onProgress?: (s: string) => void;
}) {
  const [online, setOnline] = useState(true);
  const [saved, setSaved] = useState(false);
  const [staying, setStaying] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void prefetchLocalPack();
    const sync = () => {
      const up = networkOnline();
      setOnline(up);
      if (up) {
        setStaying(false);
        setDismissed(false);
        setNote("");
      }
    };
    const sw = () => setSaved(!!navigator.serviceWorker?.controller);
    sync();
    sw();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    navigator.serviceWorker?.addEventListener("controllerchange", sw);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      navigator.serviceWorker?.removeEventListener("controllerchange", sw);
    };
  }, []);

  if (online) return null;

  async function saveZip() {
    setBusy(true);
    setNote("");
    try {
      await downloadOnThisDevice();
      setNote("Saved the zip. Unpack it and run LOCAL-SETUP on this computer.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not download. You can still chat here offline.");
    } finally {
      setBusy(false);
    }
  }

  function chooseStay() {
    setStaying(true);
    onStay?.();
    setNote("");
  }

  // After continue: slim strip under the chat header — not a big popup in the messages.
  if (staying) {
    if (dismissed) return null;
    return (
      <div className="offline-strip" role="status">
        <WifiOff size={14} aria-hidden />
        <span className="offline-strip-text">
          {saved
            ? "You’re offline — chat stays on this device."
            : "You’re offline — ask about files already on this chat."}
          {extra ? ` ${extra}` : ""}
        </span>
        <button type="button" className="ghost tiny-btn" disabled={busy} onClick={() => void saveZip()}>
          <Download size={12} /> Zip
        </button>
        <button
          type="button"
          className="icon tiny-btn"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
        >
          <X size={14} />
        </button>
        {note ? <span className="offline-strip-note">{note}</span> : null}
      </div>
    );
  }

  return (
    <div className="offline-dock" role="alertdialog" aria-modal="true" aria-labelledby="offline-title">
      <div className="offline-dock-panel">
        <WifiOff size={18} aria-hidden />
        <div className="offline-dock-copy">
          <strong id="offline-title">No internet</strong>
          <p>
            Keep chatting here with files on this chat, or download Surf for this computer.
            {extra ? ` ${extra}` : ""}
          </p>
        </div>
        <div className="offline-dock-actions">
          <button type="button" className="primary" onClick={chooseStay}>
            <MessageSquare size={14} /> {stayLabel}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={() => void saveZip()}>
            <Download size={14} /> {busy ? "Preparing…" : "Download zip"}
          </button>
        </div>
      </div>
    </div>
  );
}
