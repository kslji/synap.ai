"use client";

import dynamic from "next/dynamic";

const AdminConsole = dynamic(
  () => import("@/components/AdminConsole").then((m) => ({ default: m.AdminConsole })),
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

export default function AdminPage() {
  return <AdminConsole />;
}
