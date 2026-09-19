import type { StoredAttachment } from "./attachments";

export type { StoredAttachment } from "./attachments";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  waitMs?: number;
  backendMs?: number;
  engine?: "host" | "browser";
};

export type Thread = {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMsg[];
  hostConversationId?: string;
};

const DB = "local-ai-browser";
const STORE = "kv";
const THREADS = "threads";
const MEMORY = "memory";
const ATTACHMENTS = "attachments";

export type Memory = { summary: string; updatedAt: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function get<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const q = tx.objectStore(STORE).get(key);
    q.onsuccess = () => resolve(q.result as T | undefined);
    q.onerror = () => reject(q.error);
  });
  db.close();
  return value;
}

async function set(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listThreads(): Promise<Thread[]> {
  const all = (await get<Thread[]>(THREADS)) || [];
  return [...all].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveThread(thread: Thread): Promise<void> {
  const all = (await get<Thread[]>(THREADS)) || [];
  const next = [thread, ...all.filter((t) => t.id !== thread.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  await set(THREADS, next);
}

export async function deleteThread(id: string): Promise<void> {
  const all = (await get<Thread[]>(THREADS)) || [];
  await set(
    THREADS,
    all.filter((t) => t.id !== id),
  );
  const files = (await get<StoredAttachment[]>(ATTACHMENTS)) || [];
  await set(
    ATTACHMENTS,
    files.filter((a) => a.threadId !== id),
  );
}

export async function replaceThreads(threads: Thread[]): Promise<void> {
  await set(THREADS, threads);
}

export async function listAttachments(): Promise<StoredAttachment[]> {
  return (await get<StoredAttachment[]>(ATTACHMENTS)) || [];
}

export async function saveAttachment(file: StoredAttachment): Promise<void> {
  const zip = /\.zip$/i.test(file.name);
  const keepBytes =
    (file.kind === "image" && file.bytes && file.bytes.byteLength > 0 && file.bytes.byteLength < 400_000) ||
    (zip && file.bytes && file.bytes.byteLength > 0 && file.bytes.byteLength < 12_000_000);
  const slim: StoredAttachment = keepBytes ? file : { ...file, bytes: new ArrayBuffer(0) };
  const all = (await get<StoredAttachment[]>(ATTACHMENTS)) || [];
  await set(ATTACHMENTS, [...all.filter((a) => a.id !== slim.id), slim]);
}

export async function deleteAttachment(id: string): Promise<void> {
  const all = (await get<StoredAttachment[]>(ATTACHMENTS)) || [];
  await set(
    ATTACHMENTS,
    all.filter((a) => a.id !== id),
  );
}

export async function reassignAttachments(fromIds: string[], toThreadId: string): Promise<void> {
  const all = (await get<StoredAttachment[]>(ATTACHMENTS)) || [];
  const keep = new Set(fromIds);
  await set(
    ATTACHMENTS,
    all
      .filter((a) => keep.has(a.threadId) || a.threadId === toThreadId)
      .map((a) => (keep.has(a.threadId) ? { ...a, threadId: toThreadId } : a)),
  );
}

export async function getMemory(): Promise<Memory | null> {
  return (await get<Memory>(MEMORY)) || null;
}

export async function saveMemory(summary: string): Promise<Memory> {
  const rec: Memory = { summary: summary.trim(), updatedAt: Date.now() };
  await set(MEMORY, rec);
  return rec;
}

export function packThreads(threads: Thread[], limit = 8000): string {
  const parts: string[] = [];
  for (const t of threads) {
    const lines = t.messages
      .filter((m) => m.content.trim())
      .map((m) => `${m.role}: ${m.content.trim()}`);
    if (!lines.length) continue;
    parts.push(`# ${t.title}\n${lines.join("\n")}`);
  }
  return parts.join("\n\n").slice(0, limit);
}

export async function wipeBrowserStore(): Promise<void> {
  await dropDb(DB);
  await dropDb("local-ai-cache");
}

export async function clearAllAttachments(): Promise<void> {
  await set(ATTACHMENTS, []);
}

function dropDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0] || "New chat";
  return line.slice(0, 42);
}

export function newThread(): Thread {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    updatedAt: Date.now(),
    messages: [],
  };
}

export type DataSnapshot = {
  chats: number;
  messages: number;
  chatBytes: number;
  memoryBytes: number;
  memoryChars: number;
  fileCount: number;
  fileBytes: number;
};

export function snapshotStats(
  threads: Thread[],
  memory: Memory | null,
  files: StoredAttachment[] = [],
): DataSnapshot {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  const messages = threads.reduce((n, t) => n + t.messages.filter((m) => m.content.trim()).length, 0);
  return {
    chats: threads.filter((t) => t.messages.some((m) => m.content.trim())).length,
    messages,
    chatBytes: threads.length ? bytes(threads) : 0,
    memoryBytes: memory?.summary ? bytes(memory) : 0,
    memoryChars: memory?.summary.length ?? 0,
    fileCount: files.length,
    fileBytes: files.reduce((n, f) => n + (f.size || 0), 0),
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export type OriginStorage = {
  usage: number;
  quota: number;
  indexedDB?: number;
  caches?: number;
};

export async function originStorage(): Promise<OriginStorage | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  const details = (est as { usageDetails?: Record<string, number> }).usageDetails || {};
  return {
    usage: est.usage ?? 0,
    quota: est.quota ?? 0,
    indexedDB: details.indexedDB,
    caches: details.caches,
  };
}
