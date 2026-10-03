"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/site/button";

const navigation = [
  { href: "/agents", label: "Agents" },
  { href: "/business", label: "Business" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="site-container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <span className="grid size-8 place-items-center rounded bg-foreground font-display text-lg font-extrabold text-background">
            S
          </span>
          <span className="font-display text-lg font-bold">
            Synap<span className="text-primary">.surf</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-medium md:flex" aria-label="Main navigation">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={path === item.href ? "text-primary" : "hover:text-primary"}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-sm sm:inline-flex">
            <span className="size-1.5 rounded-full bg-primary" /> Local-first
          </span>
          <Button asChild variant="signalDark" size="sm">
            <Link href="/download">Download</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen(!open)}
          >
            {open ? <X /> : <Menu />}
          </Button>
        </div>
      </div>
      {open ? (
        <nav
          className="site-container flex flex-col gap-3 border-t border-border py-4 text-sm md:hidden"
          aria-label="Mobile navigation"
        >
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-12 border-t border-border">
      <div className="site-container flex flex-col justify-between gap-7 py-8 md:flex-row md:items-center">
        <div>
          <Link href="/" className="font-display font-bold">
            Synap<span className="text-primary">.surf</span>
          </Link>
          <p className="kicker mt-2">Local-first AI, built for focused work.</p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-xs" aria-label="Footer navigation">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/acceptable-use">Acceptable use</Link>
          <Link href="/security">Security</Link>
          <Link href="/disclaimers">Disclaimers</Link>
          <Link href="/contact">Contact</Link>
        </nav>
        <p className="kicker">© {new Date().getFullYear()} Synap.surf</p>
      </div>
    </footer>
  );
}
