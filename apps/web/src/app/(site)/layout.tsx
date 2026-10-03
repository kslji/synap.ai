import type { Metadata } from "next";
import { SiteFrame } from "@/components/site/site-frame";

export const metadata: Metadata = {
  title: "Synap.surf — Local-first AI agents",
  description: "Explore purpose-built AI agents and a local-first desktop platform for work online or offline.",
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteFrame>{children}</SiteFrame>;
}
