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

export type MemoryBatch = {
  id: string;
  createdAt: number;
  /** Plain facts for this batch only — never merged with older batches when created. */
  text: string;
  chatTitles: string[];
  /** Files attached to the chats that were summarized in THIS batch. */
  fileNames: string[];
};

export type Memory = {
  updatedAt: number;
  batches: MemoryBatch[];
};

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

function normalizeMemory(raw: unknown): Memory | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { summary?: string; updatedAt?: number; batches?: MemoryBatch[] };
  if (Array.isArray(row.batches) && row.batches.length) {
    return {
      updatedAt: row.updatedAt || Date.now(),
      batches: row.batches
        .filter((b) => b && typeof b.text === "string" && b.text.trim())
        .map((b) => ({
          id: b.id || crypto.randomUUID(),
          createdAt: b.createdAt || row.updatedAt || Date.now(),
          text: String(b.text).trim(),
          chatTitles: Array.isArray(b.chatTitles) ? b.chatTitles.map(String) : [],
          fileNames: Array.isArray(b.fileNames) ? b.fileNames.map(String) : [],
        })),
    };
  }
  // Legacy single-string memory → one batch (no invented file list).
  if (typeof row.summary === "string" && row.summary.trim()) {
    return {
      updatedAt: row.updatedAt || Date.now(),
      batches: [
        {
          id: crypto.randomUUID(),
          createdAt: row.updatedAt || Date.now(),
          text: row.summary.trim(),
          chatTitles: [],
          fileNames: [],
        },
      ],
    };
  }
  return null;
}

/** Flatten batches for prompts — each note stays a separate labeled block. */
export function memoryPromptText(memory: Memory | null, budget: number): string {
  if (!memory?.batches.length) return "";
  const blocks = memory.batches.map((b, i) => {
    const files = b.fileNames.length ? ` (files this note: ${b.fileNames.join(", ")})` : "";
    return `Memory note ${i + 1}${files}:\n${b.text}`;
  });
  return blocks.join("\n\n---\n\n").slice(0, budget);
}

/** User-facing: each saved summary separate, with only that note’s files. */
export function memoryDisplayText(memory: Memory | null): string {
  if (!memory?.batches.length) return "";
  return memory.batches
    .map((b, i) => {
      const files = b.fileNames.length
        ? `\nFiles in this note: ${b.fileNames.join(", ")}`
        : "\nFiles in this note: (none recorded)";
      const chats = b.chatTitles.length ? `\nChats: ${b.chatTitles.join("; ")}` : "";
      return `Summary ${i + 1}${chats}${files}\n${b.text}`;
    })
    .join("\n\n——\n\n");
}

export function memoryCharCount(memory: Memory | null): number {
  if (!memory?.batches.length) return 0;
  return memory.batches.reduce((n, b) => n + b.text.length, 0);
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
  return normalizeMemory(await get<unknown>(MEMORY));
}

export async function appendMemoryBatch(input: {
  text: string;
  chatTitles: string[];
  fileNames: string[];
}): Promise<Memory> {
  const text = input.text.trim();
  if (!text) throw new Error("Empty summary.");
  const prev = (await getMemory()) || { updatedAt: Date.now(), batches: [] };
  const batch: MemoryBatch = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    text: text.slice(0, 4000),
    chatTitles: [...new Set(input.chatTitles.map((t) => t.trim()).filter(Boolean))].slice(0, 40),
    fileNames: [...new Set(input.fileNames.map((t) => t.trim()).filter(Boolean))].slice(0, 80),
  };
  const next: Memory = {
    updatedAt: Date.now(),
    batches: [...prev.batches, batch].slice(-20),
  };
  await set(MEMORY, next);
  return next;
}

/** @deprecated Prefer appendMemoryBatch. */
export async function saveMemory(summary: string): Promise<Memory> {
  return appendMemoryBatch({ text: summary, chatTitles: [], fileNames: [] });
}

export async function clearMemory(): Promise<void> {
  await set(MEMORY, null);
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

/** Titles of chats that actually have messages (for a summarize batch). */
export function packThreadTitles(threads: Thread[]): string[] {
  return threads
    .filter((t) => t.messages.some((m) => m.content.trim()))
    .map((t) => t.title.trim() || "Untitled")
    .slice(0, 40);
}

/**
 * Strict erase of chats, files, and saved summaries in this browser.
 * Does not delete the on-device model cache (Cache Storage / WebLLM).
 */
export async function wipeBrowserStore(): Promise<void> {
  try {
    await set(THREADS, []);
    await set(ATTACHMENTS, []);
    await set(MEMORY, null);
  } catch {
    /* DB may already be gone or locked */
  }
  await dropDb(DB);
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
  const chars = memoryCharCount(memory);
  return {
    chats: threads.filter((t) => t.messages.some((m) => m.content.trim())).length,
    messages,
    chatBytes: threads.length ? bytes(threads) : 0,
    memoryBytes: chars ? bytes(memory) : 0,
    memoryChars: chars,
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
