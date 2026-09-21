import type { Metadata } from "next";
import "./globals.css";
import { OfflineRuntime } from "@/components/OfflineRuntime";
import { TopRotatingBanner } from "@/components/TopRotatingBanner";

export const metadata: Metadata = {
  title: "Surf AI",
  description: "Local-first AI on your computer. Download once, chat privately offline.",
  manifest: "/manifest.webmanifest",
  themeColor: "#0a1210",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Surf AI",
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <OfflineRuntime />
        <TopRotatingBanner />
        {children}
      </body>
    </html>
  );
}
