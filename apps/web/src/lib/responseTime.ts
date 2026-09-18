export type ReplyTiming = {
  waitMs?: number;
  backendMs?: number;
  engine?: "host" | "browser";
};

export function formatWait(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  return s < 1 ? "<1 s" : `${s} s`;
}

export function replyTimeLabel(t: ReplyTiming): string {
  if (t.waitMs == null) return "";
  return formatWait(t.waitMs);
}
