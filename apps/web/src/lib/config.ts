/**
 * Local-First / Small Cloud:
 * AI, Moss, device JWT, and Ollama always talk to the host on THIS machine.
 * Never send chat to the marketing VPS (synap.surf) — that broke privacy + offline.
 */
export const LOCAL_HOST =
  process.env.NEXT_PUBLIC_LOCAL_HOST?.replace(/\/$/, "") || "http://127.0.0.1:18765";

/** @deprecated alias — always the local Small Cloud host */
export const HOST = LOCAL_HOST;

/**
 * Optional bake-in for email auth / feedback (e.g. https://synap.surf).
 * Chat and Moss never use this.
 */
export const PLATFORM_HOST = (
  process.env.NEXT_PUBLIC_PLATFORM_URL ||
  ""
).replace(/\/$/, "");

export const TOKEN_KEY = "local.ai.jwt";
export const CLIENT_KEY = "local.ai.client";

export function isLoopbackHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Auth + thumbs: on any public hostname use same-origin (nginx → gunicorn).
 * On localhost / zip, use the local Small Cloud host.
 */
export function platformBase(): string {
  if (PLATFORM_HOST) return PLATFORM_HOST;
  if (typeof location !== "undefined") {
    const h = location.hostname.toLowerCase();
    if (h && h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]") {
      return location.origin;
    }
  }
  return LOCAL_HOST;
}
