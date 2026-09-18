"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import {
  deliverFeedback,
  onFeedbackFlushed,
  pendingFeedbackCount,
  type FeedbackRating,
} from "@/lib/feedback";

export function MessageFeedback({
  conversationId,
  engine,
  onSent,
}: {
  conversationId?: string | null;
  engine: "ollama" | "browser";
  onSent?: () => void;
}) {
  const [vote, setVote] = useState<FeedbackRating | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [caution, setCaution] = useState(false);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    return onFeedbackFlushed(() => {
      setQueued(pendingFeedbackCount());
      if (pendingFeedbackCount() === 0) {
        setCaution(false);
        setNote("Sent. It is not kept in this browser.");
        onSent?.();
      }
    });
  }, [onSent]);

  function pick(next: FeedbackRating) {
    setVote(next);
    setOpen(true);
    setNote("");
  }

  async function submit() {
    if (!vote || !title.trim() || !message.trim()) {
      setNote("Add a short title and a sentence about what happened.");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const status = await deliverFeedback({
        rating: vote,
        title: title.trim(),
        message: message.trim(),
        conversation_id: conversationId,
        engine,
      });
      setOpen(false);
      setTitle("");
      setMessage("");
      if (status === "queued") {
        setQueued(pendingFeedbackCount());
        setCaution(true);
        setNote("Waiting for internet. Not saved on this computer.");
      } else {
        setNote("Sent. It is not kept in this browser.");
        onSent?.();
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not send feedback.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fb">
      <div className="fb-votes">
        <button
          type="button"
          className={`icon ${vote === "up" ? "on" : ""}`}
          aria-label="Thumbs up"
          title="This reply was useful"
          onClick={() => pick("up")}
        >
          <ThumbsUp size={14} />
        </button>
        <button
          type="button"
          className={`icon ${vote === "down" ? "on" : ""}`}
          aria-label="Thumbs down"
          title="This reply needs a fix"
          onClick={() => pick("down")}
        >
          <ThumbsDown size={14} />
        </button>
      </div>
      {open && (
        <div className="fb-form">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short title"
            maxLength={120}
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="What was good or what should change?"
            maxLength={4000}
            rows={3}
          />
          <button type="button" className="ghost" disabled={busy} onClick={() => void submit()}>
            Send feedback
          </button>
        </div>
      )}
      {note && <div className="tiny muted">{note}</div>}
      {caution && (
        <div className="setup-scrim" role="alertdialog" aria-modal="true" aria-labelledby="fb-offline-title">
          <div className="setup-panel">
            <h2 id="fb-offline-title">Internet is off</h2>
            <p className="muted">
              Thumbs are stored on our backend, not on this computer. {queued} note
              {queued === 1 ? "" : "s"} wait here and send when you are online. You can wait, or keep
              chatting with attached files.
            </p>
            <button type="button" className="primary" onClick={() => setCaution(false)}>
              OK — send when online
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
