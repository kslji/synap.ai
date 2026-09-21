"use client";

import dynamic from "next/dynamic";

const LocalChat = dynamic(
  () => import("@/components/LocalChat").then((m) => ({ default: m.LocalChat })),
  {
    ssr: false,
    loading: () => (
      <div className="chat-shell">
        <p className="muted" style={{ padding: 24 }}>
          Opening chat…
        </p>
      </div>
    ),
  },
);

export default function HostPage() {
  return <LocalChat />;
}
