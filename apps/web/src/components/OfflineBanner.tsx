"use client";

import { Download, MessageSquare, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { networkOnline } from "@/lib/net";
import { warmBrowserEngine, webGpuOk } from "@/lib/webllm";

/**
 * YouTube-style offline chooser. “Continue offline chat” loads cached WebLLM
 * and keeps the document-expert assistant running in this tab.
 */
export function OfflineBanner({
  extra,
  stayLabel = "Continue offline chat",
  onStay,
  onProgress,
}: {
  extra?: string;
  stayLabel?: string;
  onStay?: () => void;
  onProgress?: (s: string) => void;
}) {
  const [online, setOnline] = useState(true);
  const [saved, setSaved] = useState(false);
  const [staying, setStaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [loadingModel, setLoadingModel] = useState(false);

  useEffect(() => {
    void prefetchLocalPack();
    const sync = () => {
      const up = networkOnline();
      setOnline(up);
      if (up) {
        setStaying(false);
        setNote("");
        setLoadingModel(false);
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
          : "Could not download. This tab still has Surf — continue offline chat here.",
      );
    } finally {
      setBusy(false);
    }
  }

  function chooseStay() {
    setStaying(true);
    onStay?.();
    if (webGpuOk()) {
      setLoadingModel(true);
      setNote("Loading your cached expert model for offline chat…");
      warmBrowserEngine((s) => {
        onProgress?.(s);
        if (s) setNote(s);
        else {
          setLoadingModel(false);
          setNote("Offline expert ready — ask about files already on this chat.");
        }
      });
    } else {
      setNote("Open this in Google Chrome only for the in-browser expert model.");
    }
  }

  if (staying) {
    return (
      <div className="memory-banner offline-card offline-card-sticky" role="status">
        <WifiOff size={14} aria-hidden />
        <div>
          <strong>Offline chat on.</strong>{" "}
          {loadingModel
            ? "Loading WebLLM from this device’s cache…"
            : saved
              ? "Your document expert is running in this tab from cached data (like a saved YouTube video)."
              : "Ask about files already on this chat. For fuller offline AI, download the zip."}
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
          Continue offline chat to keep your <strong>document expert</strong> running in this tab with
          WebLLM (uses the model already cached in Chrome). Or download the zip for fuller offline use
          on a computer.
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
