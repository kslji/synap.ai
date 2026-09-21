"use client";

import dynamic from "next/dynamic";
import { PageLoading } from "@/components/PageLoading";

const AdminConsole = dynamic(
  () => import("@/components/AdminConsole").then((m) => ({ default: m.AdminConsole })),
  {
    ssr: false,
    loading: () => <PageLoading label="Loading admin…" />,
  },
);

export default function AdminPage() {
  return <AdminConsole />;
}
