"use client";

import dynamic from "next/dynamic";
import { PageLoading } from "@/components/PageLoading";

const ChatDownloadShell = dynamic(
  () => import("@/components/ChatDownloadShell").then((m) => ({ default: m.ChatDownloadShell })),
  {
    ssr: false,
    loading: () => <PageLoading />,
  },
);

export function PackDownload() {
  return (
    <div id="pack" className="synap-pack">
      <ChatDownloadShell contained />
    </div>
  );
}
