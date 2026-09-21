/** Tiny browser caps — keep these out of webllm.ts so /chat does not load @mlc-ai/web-llm. */

export function webGpuOk(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * In-browser WebLLM can freeze tabs. For Local-First / Small Cloud we prefer the
 * local host + Ollama on the user's machine. WebLLM is only for true loopback demos
 * (localhost UI), never as a substitute for calling the marketing VPS.
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
  // Local zip / Next dev — optional light WebLLM fallback (lazy-loaded, never on open).
  if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".local")) return true;
  // synap.surf is a static shell only — AI must use Download zip → local host (127.0.0.1:18765).
  return false;
}

/** True for raw WebLLM/MLC download lines — never show these in the chat composer. */
export function isBrowserModelProgress(s: string): boolean {
  return /Fetching param cache|Loading model from cache|cache\[\d|It can take a while when we first visit|webgpu\.wasm|Start to fetch|Finish loading on WebGPU|Loading the in-browser model/i.test(
    s,
  );
}

export const BROWSER_LLM_DISABLED_HINT =
  "Local-First: AI runs on your computer, not our website server. Use Download zip → LOCAL-SETUP (starts http://127.0.0.1:18765 + Ollama). This tab stays fast and private.";

export const LOCAL_HOST_HINT =
  "Start the local Small Cloud host on this computer (Download zip → LOCAL-SETUP), then refresh. Chat, Moss, and Ollama stay on 127.0.0.1 — never on the marketing server.";
