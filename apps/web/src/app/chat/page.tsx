"use client";

import dynamic from "next/dynamic";

const ChatDownloadShell = dynamic(
  () => import("@/components/ChatDownloadShell").then((m) => ({ default: m.ChatDownloadShell })),
  {
    ssr: false,
    loading: () => (
      <div className="landing">
        <p className="muted" style={{ padding: 28 }}>
          Loading…
        </p>
      </div>
    ),
  },
);

export default function ChatPage() {
  return <ChatDownloadShell />;
}
