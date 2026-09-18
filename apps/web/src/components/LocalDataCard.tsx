"use client";

import { formatBytes, type DataSnapshot, type OriginStorage } from "@/lib/browserStore";

export type LastChange = {
  kind: "summarize" | "erase";
  before: DataSnapshot;
  after: DataSnapshot;
};

export function LocalDataCard({
  stats,
  origin,
  last,
}: {
  stats: DataSnapshot;
  origin: OriginStorage | null;
  last: LastChange | null;
  host?: { bytes: number; data_dir: string | null; sqlite?: { conversations: number; messages: number; feedback?: number } } | null;
}) {
  const modelCache = origin?.caches ?? null;

  return (
    <div className="data-card">
      <div className="tiny muted">What's saved in this browser</div>
      <ul className="data-help">
        <li>
          Chats: {stats.chats} · messages: {stats.messages}
          {stats.fileCount ? ` · files: ${stats.fileCount}` : ""}
        </li>
        <li>Size of your chats and files: {formatBytes(stats.chatBytes + stats.memoryBytes + stats.fileBytes)}</li>
        {modelCache != null && (
          <li>
            Size of the in-browser model: {formatBytes(modelCache)} (this is the AI file, not your chats)
          </li>
        )}
        {origin?.quota != null && <li>Space Chrome allows this site: {formatBytes(origin.quota)}</li>}
        {stats.memoryBytes > 0 && <li>Saved summary kept for later chats: {formatBytes(stats.memoryBytes)}</li>}
      </ul>
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Save summary deletes chat text and keeps a short note so the assistant still has context. Delete data
        removes chats, files, and that note from this browser.
      </p>
      {last && last.kind === "summarize" && (
        <div className="data-change">
          Saved a summary. Messages went from {last.before.messages} to a {formatBytes(last.after.memoryBytes)} note.
        </div>
      )}
      {last && last.kind === "erase" && (
        <div className="data-change">Deleted. This browser now has {last.after.chats} chats.</div>
      )}
    </div>
  );
}
