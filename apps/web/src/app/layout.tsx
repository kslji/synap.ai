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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,650&family=Sora:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body suppressHydrationWarning>
        <OfflineRuntime />
        <TopRotatingBanner />
        {children}
      </body>
    </html>
  );
}
