/** Tiny browser caps — keep these out of webllm.ts so /chat does not load @mlc-ai/web-llm. */

export function webGpuOk(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * In-browser WebLLM freezes tabs (Page Unresponsive). Production sites must not run it.
 * Enabled only on loopback / explicit opt-in (local zip demo).
 */
export function allowInBrowserLlm(): boolean {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ALLOW_BROWSER_LLM === "1") {
    return true;
  }
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_ALLOW_BROWSER_LLM === "0") {
    return false;
  }
  if (typeof location === "undefined") return false;
  const h = location.hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".local")) return true;
  // Shared / production hosts — keep the tab responsive for judges and users.
  if (h === "synap.surf" || h.endsWith(".synap.surf")) return false;
  // Other deployed hosts: default off unless opted in above.
  return false;
}

/** True for raw WebLLM/MLC download lines — never show these in the chat composer. */
export function isBrowserModelProgress(s: string): boolean {
  return /Fetching param cache|Loading model from cache|cache\[\d|It can take a while when we first visit|webgpu\.wasm|Start to fetch|Finish loading on WebGPU|Loading the in-browser model/i.test(
    s,
  );
}

export const BROWSER_LLM_DISABLED_HINT =
  "This site keeps the tab fast — the heavy in-browser model is off here. Start Ollama on this computer, or use Download zip for full local AI.";
