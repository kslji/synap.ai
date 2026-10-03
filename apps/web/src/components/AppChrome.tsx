"use client";

import { usePathname } from "next/navigation";
import { DeviceSupportGate } from "@/components/DeviceSupportGate";
import { OfflineRuntime } from "@/components/OfflineRuntime";
import { TopRotatingBanner } from "@/components/TopRotatingBanner";

const MARKETING = new Set([
  "/",
  "/agents",
  "/business",
  "/contact",
  "/download",
  "/privacy",
  "/terms",
  "/acceptable-use",
  "/security",
  "/disclaimers",
]);

export function AppChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
  const marketing = MARKETING.has(path);

  return (
    <>
      <OfflineRuntime />
      {marketing ? null : <TopRotatingBanner />}
      {marketing && path !== "/download" ? null : <DeviceSupportGate />}
      {children}
    </>
  );
}
