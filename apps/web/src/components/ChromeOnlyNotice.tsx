"use client";

import { useEffect, useState } from "react";

/** True for Google Chrome (desktop Chrome or Chrome on iOS). Not Edge / Opera / Firefox / Safari. */
export function isGoogleChrome(): boolean {
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent;
  if (/Edg\/|EdgiOS|OPR\/|Opera|Brave|SamsungBrowser|YaBrowser|Firefox|FxiOS/i.test(ua)) {
    return false;
  }
  // Chrome on iOS
  if (/CriOS\//i.test(ua)) return true;
  // Desktop Chrome
  return /Chrome\//i.test(ua);
}

/**
 * Surf’s in-browser model needs Google Chrome. Shown on landing + chat.
 */
export function ChromeOnlyNotice({ compact = false }: { compact?: boolean }) {
  const [chrome, setChrome] = useState(true);

  useEffect(() => {
    setChrome(isGoogleChrome());
  }, []);

  if (compact) {
    return (
      <p className={`chrome-only-note${chrome ? "" : " chrome-only-note-warn"}`} role="note">
        Open this in <strong>Google Chrome</strong> only.
        {!chrome ? (
          <>
            {" "}
            <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
              Get Chrome
            </a>
          </>
        ) : null}
      </p>
    );
  }

  return (
    <div className={`chrome-only-banner${chrome ? "" : " chrome-only-banner-warn"}`} role="note">
      <strong>Open this in Google Chrome only.</strong>
      <span>
        {chrome
          ? " Surf’s in-browser model is built for Chrome."
          : " This browser is not Google Chrome — open Surf in Chrome for the best experience."}
      </span>
      {!chrome ? (
        <>
          {" "}
          <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
            Download Google Chrome
          </a>
        </>
      ) : null}
    </div>
  );
}
