"use client";

import { useEffect } from "react";
import { prefetchLocalPack } from "@/lib/openOnDevice";

const WARM = [
  "/",
  "/chat",
  "/chat.html",
  "/host",
  "/host.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.png",
  "/surf.png",
  "/local-agent.html",
  "/LOCAL-SETUP.sh",
  "/LOCAL-SETUP.bat",
  "/system.md",
  "/web-llm.js",
  "/pdf.js",
  "/pdf.worker.js",
  "/icon.svg",
  "/favicon.png",
  "/apple-icon.png",
];

/** Save the website on this device (YouTube-style) so refresh still works with Wi-Fi off. */
export function OfflineRuntime() {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    void Promise.all([
      prefetchLocalPack(),
      ...WARM.map((path) => fetch(path, { credentials: "same-origin" }).catch(() => null)),
      fetch("/sw-assets.json", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : []))
        .then((urls) =>
          Promise.all(
            (Array.isArray(urls) ? urls : []).map((path) =>
              fetch(path, { credentials: "same-origin" }).catch(() => null),
            ),
          ),
        )
        .catch(() => null),
    ]);
  }, []);
  return null;
}
