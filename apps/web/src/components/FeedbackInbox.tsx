"use client";

import { useCallback, useEffect, useState } from "react";
import { listFeedback, type FeedbackItem } from "@/lib/feedback";

export function FeedbackInbox({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);

  const load = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setItems([]);
      return;
    }
    try {
      setItems(await listFeedback(12));
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const on = () => void load();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [load, refreshKey]);

  return (
    <div className="data-card fb-inbox">
      <div className="tiny muted">Human feedback</div>
      <p className="tiny muted" style={{ margin: "6px 0 0" }}>
        Human feedback will be received on our backend and we will check what the problem is and
        fix that as soon as possible.
      </p>
      {items.length > 0 && (
        <ul className="fb-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className={item.rating === "up" ? "ok" : "warn"}>{item.rating === "up" ? "up" : "down"}</span>
              {" · "}
              {item.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
