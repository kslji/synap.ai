"use client";

import { Download, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadOnThisDevice, prefetchLocalPack } from "@/lib/openOnDevice";
import { networkOnline } from "@/lib/net";

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

  if (staying) {
    return (
      <div className="memory-banner offline-card" role="status">
        <strong>Offline.</strong>{" "}
        {saved
          ? "This website is saved on this computer, like YouTube with downloads. Your chats and files still open here."
          : "Stay in Surf. Your chats on this computer still work."}
        {extra ? ` ${extra}` : ""}
        <div className="offline-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void saveZip()}>
            <Download size={14} /> Download a local copy
          </button>
        </div>
        {note ? <p className="tiny muted">{note}</p> : null}
      </div>
    );
  }

  return (
    <div className="memory-banner offline-card" role="status">
      <strong>Wi-Fi is off.</strong>{" "}
      {saved
        ? "You can still use this website. Pages and chats already on this device stay available — same idea as saved YouTube videos."
        : "This tab still has Surf. Use it now, or save a copy on this computer."}
      {extra ? ` ${extra}` : ""}
      <div className="offline-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            setStaying(true);
            onStay?.();
          }}
        >
          <MessageSquare size={14} /> {stayLabel}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => void saveZip()}>
          <Download size={14} /> Download and chat on this computer
        </button>
      </div>
      {note ? <p className="tiny muted">{note}</p> : null}
    </div>
  );
}
