export type OsKind = "mac" | "win" | "linux";

/** Phones/tablets: no Terminal for LOCAL-SETUP — use in-browser chat instead. */
export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
  if (/iPad/i.test(ua)) return true;
  // iPadOS 13+ can report as Mac; treat touch Macs as mobile for setup.
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

export function detectOs(): OsKind {
  if (typeof navigator === "undefined") return "mac";
  if (/Win/i.test(navigator.userAgent)) return "win";
  // Android UA contains "Linux" — only treat as desktop Linux when not mobile.
  if (/Linux/i.test(navigator.userAgent) && !isMobileBrowser()) return "linux";
  return "mac";
}

export function installerFor(os: OsKind): { url: string; filename: string; openHint: string } {
  if (os === "win") {
    return {
      url: "https://ollama.com/download/OllamaSetup.exe",
      filename: "OllamaSetup.exe",
      openHint: "Open OllamaSetup.exe, install, then leave Ollama running in the tray.",
    };
  }
  if (os === "linux") {
    return {
      url: "https://ollama.com/install.sh",
      filename: "install-ollama.sh",
      openHint: "In a terminal: curl -fsSL https://ollama.com/install.sh | sh",
    };
  }
  return {
    url: "https://ollama.com/download/Ollama.dmg",
    filename: "Ollama.dmg",
    openHint: "Open Ollama.dmg, drag Ollama to Applications, launch it once.",
  };
}

export function startInstallerDownload(os: OsKind): void {
  const spec = installerFor(os);
  const a = document.createElement("a");
  a.href = spec.url;
  a.download = spec.filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const CONSENT_KEY = "local.ai.runtime.allow";
