import { CLIENT_KEY, HOST, TOKEN_KEY } from "./config";

/**
 * All of these calls go to HOST = http://127.0.0.1:18765 (user's Small Cloud).
 * They intentionally do NOT use the synap.surf VPS for chat / Moss / Ollama.
 */

async function fetchTimed(url: string, init: RequestInit = {}, ms = 4000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Stable per-browser id used as Moss owner when email sign-in is skipped. */
export function deviceClientId(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id || id.length < 8) {
    id = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "").slice(0, 32);
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id.slice(0, 80);
}

/** Mint or refresh a loopback JWT so Moss index/search works without email sign-in. */
export async function mintDeviceSession(): Promise<string> {
  const res = await fetchTimed(
    `${HOST}/v1/auth/session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: deviceClientId() }),
    },
    4000,
  );
  if (!res.ok) throw new Error(parseApiError(await res.text()));
  const data = (await res.json()) as { token: string };
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token;
}

export async function ensureSession(): Promise<string> {
  const existing = getToken();
  if (existing) return existing;
  return mintDeviceSession();
}

export async function api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await ensureSession();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  const timeoutMs = /\/v1\/memory/.test(path) ? 4000 : 12000;
  const res = await fetchTimed(`${HOST}${path}`, { ...init, headers }, timeoutMs);
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    if (!retried) {
      try {
        await mintDeviceSession();
        return api(path, init, true);
      } catch {
        /* fall through */
      }
    }
    throw new Error("Could not open a local Small Cloud session (is LOCAL-SETUP running on this computer?).");
  }
  if (!res.ok) throw new Error(parseApiError(await res.text()));
  return res.json() as Promise<T>;
}

function detailLine(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object" && "msg" in item) {
    const row = item as { msg: string; loc?: unknown };
    const loc = Array.isArray(row.loc)
      ? row.loc.filter((part) => part !== "body" && part !== "query").join(" ")
      : "";
    const msg = row.msg.replace(/^Value error,\s*/i, "");
    if (/password/i.test(loc) && /at least 8/i.test(msg)) {
      return "Password must be at least 8 characters.";
    }
    return loc ? `${loc}: ${msg}` : msg;
  }
  return "";
}

export function parseApiError(raw: string): string {
  const friendly = friendlyModelError(raw);
  if (friendly) return friendly;
  try {
    const j = JSON.parse(raw) as { detail?: unknown };
    if (typeof j.detail === "string") return j.detail;
    if (Array.isArray(j.detail)) {
      const lines = j.detail.map(detailLine).filter(Boolean);
      if (lines.length) return lines.join(" ");
    }
  } catch {
    /* plain text */
  }
  return raw.replace(/^\s*\{|\}\s*$/g, "").slice(0, 400);
}

function friendlyModelError(raw: string): string | null {
  if (/context window|prompt tokens exceed/i.test(raw)) {
    return "That document is larger than the on-device model's context. Ask again — shorter excerpts are used — or start Ollama (llama3.2:3b) for longer files.";
  }
  return null;
}

export type Health = {
  ok: boolean;
  ollama: boolean;
  default_model: string;
  active_model?: string;
  model_installed: boolean;
  keep_alive: string;
  num_ctx?: number;
  num_thread?: number;
  ram: { ram_gb: number; label: string };
  runtime?: {
    ram_gb: number;
    threads: number;
    keep_alive: string;
    mmap: boolean;
    prefix_cache: string;
    active_model?: string;
    backend?: string | null;
    note?: string;
  };
  local_llm?: {
    backend: string | null;
    url: string | null;
    models: string[];
    available?: Array<{ backend: string; url: string; models: string[] }>;
    note?: string;
  };
  privacy: { chat: string; voice: string; platform_bytes: number };
  livekit: { configured: boolean; url: string; reachable?: boolean };
  moss: { enabled: boolean; backend: string; docs: number; sdk?: boolean };
  vault?: {
    password_set: boolean;
    unlocked: boolean;
    algorithm: string;
    kdf: string;
  };
  onboarding?: {
    host: boolean;
    ollama: boolean;
    model: boolean;
    livekit: boolean;
    moss_sdk: boolean;
    vault_unlocked: boolean;
  };
  connectivity: string;
  deferred?: string[];
  storage?: {
    bytes: number;
    data_dir: string | null;
    sqlite?: { conversations: number; messages: number; feedback?: number };
  };
  platform?: {
    name: string;
    role: string;
    stores_user_data: boolean;
    user_home: string;
    instance: { id: string; name: string; data_dir: string; created_at?: string | null } | null;
    instances: Array<{ id: string; name: string; data_dir: string; active?: boolean }>;
  };
};

export async function health(): Promise<Health> {
  const res = await fetchTimed(`${HOST}/v1/health`, {}, 2500);
  if (!res.ok) throw new Error("Local host unreachable");
  return res.json();
}

export type MossHit = {
  docs?: Array<{ text?: string }>;
  time_taken_ms?: number;
  backend?: string;
};

export async function searchMoss(q: string): Promise<MossHit | null> {
  try {
    return await api<MossHit>(`/v1/memory/search?q=${encodeURIComponent(q)}`);
  } catch {
    return null;
  }
}

export async function indexMoss(text: string, docId?: string): Promise<boolean> {
  try {
    await api("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ text: text.slice(0, 16000), id: docId }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function fetchHostStorage(): Promise<{
  bytes: number;
  data_dir: string | null;
  sqlite?: { conversations: number; messages: number; feedback?: number };
  files?: Array<{ path: string; bytes: number }>;
  actions?: Record<string, string>;
} | null> {
  try {
    const res = await fetchTimed(`${HOST}/v1/storage`, {}, 2500);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function createLocalInstance(name: string): Promise<void> {
  localStorage.removeItem(TOKEN_KEY);
  const res = await fetch(`${HOST}/v1/instances`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(parseApiError(await res.text()));
}

export async function activateLocalInstance(id: string): Promise<void> {
  localStorage.removeItem(TOKEN_KEY);
  const res = await fetch(`${HOST}/v1/instances/${id}/activate`, { method: "POST" });
  if (!res.ok) throw new Error(parseApiError(await res.text()));
}

export async function streamChat(body: {
  content: string;
  conversation_id?: string | null;
  voice_input?: boolean;
  offline?: boolean;
  signal?: AbortSignal;
  onMeta: (m: Record<string, unknown>) => void;
  onDelta: (t: string) => void;
}): Promise<{ conversation_id: string; latency_ms?: number }> {
  const token = await ensureSession();
  const res = await fetch(`${HOST}/v1/chat`, {
    method: "POST",
    signal: body.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: body.content.slice(0, 48000),
      conversation_id: body.conversation_id,
      voice_input: body.voice_input ?? false,
      offline: body.offline ?? false,
    }),
  });
  if (!res.ok || !res.body) throw new Error(parseApiError(await res.text()));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let conversation_id = body.conversation_id || "";
  let latency_ms: number | undefined;
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  body.signal?.addEventListener("abort", onAbort);
  try {
    while (true) {
      if (body.signal?.aborted) throw new DOMException("Stopped", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        if (body.signal?.aborted) throw new DOMException("Stopped", "AbortError");
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.type === "meta") {
          conversation_id = payload.conversation_id;
          body.onMeta(payload);
        } else if (payload.type === "delta") {
          body.onDelta(payload.content);
        } else if (payload.type === "done") {
          if (typeof payload.latency_ms === "number") latency_ms = payload.latency_ms;
        } else if (payload.type === "error") {
          throw new Error(payload.detail);
        }
      }
    }
  } finally {
    body.signal?.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
  return { conversation_id, latency_ms };
}

/** Wipe host chat history + Moss index (pairs with browser Delete data). */
export async function eraseHostData(): Promise<void> {
  try {
    await api("/v1/storage/erase", { method: "POST" });
  } catch {
    /* host may be down — browser wipe still proceeds */
  }
}
