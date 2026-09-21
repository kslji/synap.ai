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

export default function DownloadPage() {
  return <ChatDownloadShell />;
}
