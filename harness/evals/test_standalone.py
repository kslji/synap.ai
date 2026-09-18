#!/usr/bin/env python3
"""Downloaded zip must chat without an email account and must not ship host auth code."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps" / "web" / "public"
PUBLIC_HTML = PUBLIC / "local-agent.html"
FORBIDDEN_IN_PUBLIC = {
    "auth.py",
    "accounts.py",
    "mail_queue.py",
    "livekit_tokens.py",
    "main.py",
}


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    html = PUBLIC_HTML.read_text(encoding="utf-8")
    check("standalone-html-present", PUBLIC_HTML.is_file(), str(PUBLIC_HTML), rows)
    check("defines-localOn", "function localOn(" in html, "localOn()", rows)
    check("standalone-hides-chrome-auth", "html.standalone #sign-out" in html and "html.standalone #dl-zip" in html, "CSS hide sign-out/zip", rows)
    check("standalone-feedback-local", "if (isStandalone())" in html and "fbInbox" in html, "local thumbs inbox", rows)
    check("reply-time-seconds-only", 'return s < 1 ? "<1 s"' in html or "s + \" s\"" in html, "seconds only", rows)
    check("standalone-probes-ollama-not-host", "function standaloneHealth()" in html and "11434/api/tags" in html, "standaloneHealth + Ollama tags", rows)
    check("standalone-skips-host-jwt", "function useHostChat(" in html, "useHostChat()", rows)
    check("standalone-ollama-direct", "function ollamaDirect(" in html, "ollamaDirect()", rows)
    check(
        "standalone-port-guard",
        'location.port === "18766"' in html,
        "port 18766",
        rows,
    )
    send_idx = html.find("async function send()")
    token_throw = html.find('throw new Error("Sign in with your email profile first.")')
    ollama_chat = html.find("async function ollamaChat(")
    check(
        "send-defined-before-ollamaChat",
        send_idx != -1 and ollama_chat != -1,
        f"send={send_idx} ollamaChat={ollama_chat}",
        rows,
    )
    check(
        "zip-chat-does-not-require-profile",
        "if (ollamaOn)" in html and "useHostChat(h)" in html and "isStandalone()" in html[send_idx:send_idx + 4000],
        "send() uses useHostChat / standalone fallback",
        rows,
    )
    check(
        "sign-in-error-only-in-token-helper",
        token_throw != -1 and "async function token(" in html[:token_throw],
        "token() still exists for the hosted page",
        rows,
    )

    names = {p.name for p in PUBLIC.iterdir() if p.is_file()}
    leaked = sorted(FORBIDDEN_IN_PUBLIC & names)
    check("zip-has-no-host-auth", not leaked, str(leaked), rows)
    check("zip-has-setup-script", "LOCAL-SETUP.sh" in names and "LOCAL-SETUP.bat" in names, "LOCAL-SETUP.sh", rows)
    check("zip-has-agent-page", "local-agent.html" in names, "local-agent.html", rows)
    check(
        "zip-html-hides-sign-out",
        "so.hidden = isStandalone()" in html or "so.hidden = true" in html,
        "Sign out hidden on :18766",
        rows,
    )
    check(
        "zip-html-has-standalone-chat",
        "function isStandalone()" in html and "function ollamaDirect(" in html and "function standaloneHealth()" in html,
        "public HTML is the zip agent",
        rows,
    )

    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
