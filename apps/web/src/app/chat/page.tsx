"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old /chat URL → download page (agent + model zip). */
export default function ChatRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/download");
  }, [router]);
  return (
    <div className="landing">
      <p className="muted" style={{ padding: 28 }}>
        Opening download…
      </p>
    </div>
  );
}
