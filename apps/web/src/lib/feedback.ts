import { platformBase, TOKEN_KEY } from "./config";
import { parseApiError } from "./api";
import { networkOnline, waitForOnline } from "./net";

export type FeedbackRating = "up" | "down";

export type FeedbackDraft = {
  rating: FeedbackRating;
  title: string;
  message: string;
  conversation_id?: string | null;
  engine?: string | null;
};

export type FeedbackItem = {
  id: string;
  rating: FeedbackRating;
  title: string;
  message: string;
  conversation_id: string | null;
  client_id: string;
  engine: string | null;
  flags: string[];
  created_at: string;
};

const queue: FeedbackDraft[] = [];
const flushed = new Set<() => void>();

export { networkOnline } from "./net";

export function pendingFeedbackCount(): number {
  return queue.length;
}

export function onFeedbackFlushed(cb: () => void): () => void {
  flushed.add(cb);
  return () => flushed.delete(cb);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postFeedback(body: FeedbackDraft): Promise<FeedbackItem> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error("Sign in to send feedback.");
  const res = await fetch(`${platformBase()}/v1/feedback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      rating: body.rating,
      title: body.title.slice(0, 120),
      message: body.message.slice(0, 4000),
      conversation_id: body.conversation_id || null,
      engine: body.engine || null,
    }),
  });
  if (!res.ok) throw new Error(parseApiError(await res.text()));
  return res.json() as Promise<FeedbackItem>;
}

let flushing = false;

async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (queue.length) {
      if (!networkOnline()) await waitForOnline();
      const next = queue[0];
      try {
        await postFeedback(next);
        queue.shift();
        flushed.forEach((cb) => cb());
      } catch {
        await delay(2500);
        if (!networkOnline()) await waitForOnline();
      }
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flushQueue();
  });
}

/** Never writes IndexedDB/localStorage. Offline: RAM only, POST when the network is back. */
export async function deliverFeedback(body: FeedbackDraft): Promise<"sent" | "queued"> {
  const draft: FeedbackDraft = {
    ...body,
    title: body.title.trim().slice(0, 120),
    message: body.message.trim().slice(0, 4000),
  };
  if (!networkOnline()) {
    queue.push(draft);
    void flushQueue();
    return "queued";
  }
  try {
    await postFeedback(draft);
    flushed.forEach((cb) => cb());
    return "sent";
  } catch {
    queue.push(draft);
    void flushQueue();
    return "queued";
  }
}

export async function listFeedback(limit = 40): Promise<FeedbackItem[]> {
  if (!networkOnline()) return [];
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return [];
  const res = await fetch(`${platformBase()}/v1/feedback?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(parseApiError(await res.text()));
  const data = (await res.json()) as { items: FeedbackItem[] };
  return data.items || [];
}
