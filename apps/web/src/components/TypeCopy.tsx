"use client";

import { useEffect, useState, type ReactNode } from "react";

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function typeText(
  text: string,
  set: (s: string) => void,
  ms: number,
  stopped: () => boolean,
) {
  for (let i = 1; i <= text.length; i++) {
    if (stopped()) return;
    set(text.slice(0, i));
    const ch = text[i - 1];
    const pause = ch === "." || ch === "!" ? ms * 8 : ch === "," ? ms * 4 : ms;
    await wait(pause);
  }
}

async function eraseText(
  text: string,
  set: (s: string) => void,
  ms: number,
  stopped: () => boolean,
) {
  for (let i = text.length - 1; i >= 0; i--) {
    if (stopped()) return;
    set(text.slice(0, i));
    const ch = text[i];
    const pause = ch === "." || ch === "!" ? ms * 2.2 : ch === " " ? ms * 1.35 : ms;
    await wait(pause);
  }
  set("");
}

export function LandingTypeCycle({
  headlines,
  lede,
  points,
  holdMs = 10_000,
  middle,
}: {
  headlines: readonly string[];
  lede: string;
  points: readonly string[];
  holdMs?: number;
  middle?: ReactNode;
}) {
  const [head, setHead] = useState("");
  const [blurb, setBlurb] = useState("");
  const [rows, setRows] = useState<string[]>([]);
  const [caret, setCaret] = useState<"h" | "l" | number | "none">("h");

  useEffect(() => {
    if (!headlines.length) return;
    if (prefersReducedMotion()) {
      setHead(headlines[0]);
      setBlurb(lede);
      setRows([...points]);
      setCaret("none");
      return;
    }
    let stop = false;
    const stopped = () => stop;
    let hi = 0;

    void (async () => {
      while (!stop) {
        const headline = headlines[hi % headlines.length];
        hi += 1;
        setCaret("h");
        await typeText(headline, setHead, 28, stopped);
        if (stop) return;
        setCaret("l");
        await typeText(lede, setBlurb, 16, stopped);
        if (stop) return;
        const built: string[] = [];
        for (let n = 0; n < points.length; n++) {
          if (stop) return;
          setCaret(n);
          built[n] = "";
          setRows([...built]);
          await typeText(
            points[n],
            (s) => {
              built[n] = s;
              setRows([...built]);
            },
            12,
            stopped,
          );
          await wait(180);
        }
        if (stop) return;
        setCaret(points.length - 1);
        await wait(holdMs);
        if (stop) return;

        for (let n = points.length - 1; n >= 0; n--) {
          if (stop) return;
          setCaret(n);
          await eraseText(
            built[n] || points[n],
            (s) => {
              built[n] = s;
              setRows(built.slice(0, n + (s ? 1 : 0)));
            },
            110,
            stopped,
          );
          await wait(350);
        }
        setRows([]);
        if (stop) return;
        setCaret("l");
        await eraseText(lede, setBlurb, 105, stopped);
        if (stop) return;
        await wait(325);
        setCaret("h");
        await eraseText(headline, setHead, 120, stopped);
        await wait(600);
      }
    })();

    return () => {
      stop = true;
    };
  }, [headlines, lede, points, holdMs]);

  return (
    <>
      <h1>
        {head}
        {caret === "h" ? <span className="type-caret" aria-hidden /> : null}
      </h1>
      {(blurb || caret === "l") && (
        <p className="lede">
          {blurb}
          {caret === "l" ? <span className="type-caret" aria-hidden /> : null}
        </p>
      )}
      {middle}
      {rows.length > 0 && (
        <ul className="points">
          {rows.map((line, i) => (
            <li key={`${i}-${points[i]?.slice(0, 12) || i}`}>
              {line}
              {caret === i ? <span className="type-caret" aria-hidden /> : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
