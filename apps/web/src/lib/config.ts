/**
 * Local-First / Small Cloud:
 * AI, Moss, JWT sessions, and Ollama always talk to the host on THIS machine.
 * Never send chat to the marketing VPS (synap.surf) — that broke privacy + offline.
 */
export const LOCAL_HOST =
  process.env.NEXT_PUBLIC_LOCAL_HOST?.replace(/\/$/, "") || "http://127.0.0.1:18765";

/** @deprecated alias — always the local Small Cloud host */
export const HOST = LOCAL_HOST;

/**
 * Optional separate URL for email auth / feedback only (e.g. https://synap.surf).
 * Chat and Moss never use this. Leave unset to use LOCAL_HOST for everything.
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
