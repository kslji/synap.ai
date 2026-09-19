"use client";

import { Download, MessageSquare, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { networkOnline } from "@/lib/net";

/**
 * YouTube-style offline chooser: keep chatting in this tab, or download the zip
 * for full offline on a computer. Not removed — still wired from LocalChat + landing.
 */
export function OfflineBanner({
  extra,
  stayLabel = "Keep using Surf",
  onStay,
}: {
  extra?: string;
  stayLabel?: string;
  onStay?: () => void;
}) {
  const [online, setOnline] = useState(true);
  const [saved, setSaved] = useState(false);
  const [staying, setStaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    void prefetchLocalPack();
    const sync = () => {
      const up = networkOnline();
      setOnline(up);
      if (up) {
        setStaying(false);
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
      setNote("Saved local-ai-on-this-device.zip. Unpack it and run LOCAL-SETUP on this computer.");
    } catch (err) {
      setNote(
        err instanceof Error
          ? err.message
          : "Could not download. This tab still has Surf — keep chatting here.",
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseStay() {
    setStaying(true);
    onStay?.();
  }

  if (staying) {
    return (
      <div className="memory-banner offline-card offline-card-sticky" role="status">
        <WifiOff size={14} aria-hidden />
        <div>
          <strong>Offline — still in this chat.</strong>{" "}
          {saved
            ? "This site is saved on this device (like YouTube downloads). Attached files still work here."
            : "You can keep asking about files already on this chat. For full offline AI, download the zip."}
          {extra ? ` ${extra}` : ""}
          <div className="offline-actions">
            <button type="button" className="ghost" disabled={busy} onClick={() => void saveZip()}>
              <Download size={14} /> Download zip for this computer
            </button>
          </div>
          {note ? <p className="tiny muted">{note}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="offline-scrim" role="alertdialog" aria-modal="true" aria-labelledby="offline-title">
      <div className="offline-panel">
        <div className="offline-panel-icon" aria-hidden>
          <WifiOff size={22} />
        </div>
        <h2 id="offline-title">You are offline</h2>
        <p className="muted">
          {saved
            ? "Surf is still available on this device — same idea as watching a saved YouTube video. Keep chatting here, or save the zip for fuller offline use on a computer."
            : "This tab still has Surf. Keep chatting with files already on this chat, or download a copy to run on your computer without Wi‑Fi."}
          {extra ? ` ${extra}` : ""}
        </p>
        <div className="offline-actions offline-actions-stack">
          <button type="button" className="primary wide" onClick={chooseStay}>
            <MessageSquare size={16} /> {stayLabel}
          </button>
          <button type="button" className="ghost wide" disabled={busy} onClick={() => void saveZip()}>
            <Download size={16} /> {busy ? "Preparing zip…" : "Download zip and chat on this computer"}
          </button>
        </div>
        {note ? <p className="tiny muted">{note}</p> : null}
      </div>
    </div>
  );
}
