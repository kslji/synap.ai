"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Slide = {
  text: string;
  action?: { label: string; href: string; external?: boolean };
};

const SLIDES: Slide[] = [
  {
    text: "Private AI on your computer. Chats stay on your device.",
  },
  {
    text: "Download once. Run one command. Chat offline.",
    action: { label: "Download", href: "/download" },
  },
];

const HOLD_MS = 5500;

export function TopRotatingBanner() {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    let outTimer: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => {
      setPhase("out");
      outTimer = setTimeout(() => {
        setI((n) => (n + 1) % SLIDES.length);
        setPhase("in");
      }, 320);
    }, HOLD_MS);
    return () => {
      clearInterval(tick);
      if (outTimer) clearTimeout(outTimer);
    };
  }, []);

  const slide = SLIDES[i];

  return (
    <div className="top-rotate-banner" role="status" aria-live="polite">
      <div className={`top-rotate-inner top-rotate-${phase}`} key={i}>
        <span className="top-rotate-text">{slide.text}</span>
        {slide.action ? (
          slide.action.external ? (
            <a
              className="top-rotate-link"
              href={slide.action.href}
              target="_blank"
              rel="noreferrer"
            >
              {slide.action.label}
            </a>
          ) : (
            <Link className="top-rotate-link" href={slide.action.href}>
              {slide.action.label}
            </Link>
          )
        ) : null}
      </div>
    </div>
  );
}
