"use client";

import { formatBytes, type DataSnapshot, type OriginStorage } from "@/lib/browserStore";

export type LastChange = {
  kind: "summarize" | "erase";
  before: DataSnapshot;
  after: DataSnapshot;
  /** Only the files/chats folded into THIS summarize — never prior batches. */
  batch?: {
    fileNames: string[];
    chatTitles: string[];
  };
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
            Size of the on-device model: {formatBytes(modelCache)} (the model file on this browser, not your chats)
          </li>
        )}
        {origin?.quota != null && <li>Space Chrome allows this site: {formatBytes(origin.quota)}</li>}
        {stats.memoryBytes > 0 && <li>Saved summary kept for later chats: {formatBytes(stats.memoryBytes)}</li>}
      </ul>
      <p className="tiny muted data-card-note">
        Save summary keeps a short note for the chats you just folded — older notes stay separate. Delete clears
        chats and files from this browser.
      </p>
      {last && last.kind === "summarize" && (
        <div className="data-change">
          Saved a summary for this batch only
          {last.batch?.chatTitles?.length ? ` (${last.batch.chatTitles.length} chat${last.batch.chatTitles.length === 1 ? "" : "s"})` : ""}
          . Messages went from {last.before.messages} to a {formatBytes(last.after.memoryBytes)} note.
          {last.batch?.fileNames?.length ? (
            <>
              <br />
              Files in this summary: {last.batch.fileNames.join(", ")}
            </>
          ) : (
            <>
              <br />
              No files were attached to the chats in this summary.
            </>
          )}
        </div>
      )}
      {last && last.kind === "erase" && (
        <div className="data-change">
          Deleted. This browser now has {last.after.chats} chats and {last.after.fileCount} files.
        </div>
      )}
    </div>
  );
}
