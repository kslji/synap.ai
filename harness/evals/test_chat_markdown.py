#!/usr/bin/env python3
"""Chat Markdown renderer must cover fences, tables, JSON, streaming close, file refs."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "apps" / "web" / "src" / "lib" / "chatMarkdown.ts"
BODY = ROOT / "apps" / "web" / "src" / "components" / "MarkdownBody.tsx"
HTML = ROOT / "apps" / "web" / "public" / "local-agent.html"
CSS = ROOT / "apps" / "web" / "src" / "app" / "globals.css"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    lib = LIB.read_text(encoding="utf-8")
    body = BODY.read_text(encoding="utf-8")
    html = HTML.read_text(encoding="utf-8")
    css = CSS.read_text(encoding="utf-8")

    check("chat-markdown-lib-present", LIB.is_file(), str(LIB), rows)
    for sym in (
        "prepareForRender",
        "splitMarkdownChunks",
        "parseTableAt",
        "highlightTokens",
        "looksLikeJsonBlock",
        "isFileRef",
        "formatCodeBody",
    ):
        check(f"lib-exports-{sym}", f"export function {sym}" in lib, sym, rows)

    check("markdown-body-uses-shared-lib", 'from "@/lib/chatMarkdown"' in body, "import chatMarkdown", rows)
    check("markdown-body-copy-button", "Copy" in body and "navigator.clipboard" in body, "copy", rows)
    check("markdown-body-streaming-prop", "streaming" in body and "prepareForRender" in body, "streaming", rows)
    check("markdown-body-tables", "MdTable" in body and "parseTableAt" in body, "tables", rows)
    check("markdown-body-file-ref", "md-file-ref" in body or "FileRef" in body, "file refs", rows)

    check("localchat-wires-markdown", 'MarkdownBody' in (ROOT / "apps/web/src/components/LocalChat.tsx").read_text(encoding="utf-8"), "LocalChat", rows)
    check(
        "localchat-streaming-flag",
        re.search(r"streaming=\{Boolean\(busy && lastAssistant\)\}", (ROOT / "apps/web/src/components/LocalChat.tsx").read_text(encoding="utf-8"))
        is not None,
        "streaming prop",
        rows,
    )

    check("agent-md-code-copy", "md-code-copy" in html and "bindCodeCopy" in html, "agent copy", rows)
    check("agent-prepare-md", "function prepareMd(" in html, "prepareMd", rows)
    check("agent-tables", "md-table" in html and "parseTableLines" in html, "agent tables", rows)
    check(
        "agent-streaming-fill",
        "fillMarkdown(bot, streamBuf, true)" in html or "paintStreamingMarkdown(bot, streamBuf)" in html,
        "stream fill",
        rows,
    )
    check("css-code-bar", ".md-code-bar" in css and ".md-table" in css, "theme styles", rows)
    check("css-tokens", ".md-tok-str" in css and ".md-file-ref" in css, "token styles", rows)

    # Streaming close: odd fence count appends closer
    check(
        "prepare-closes-odd-fence",
        "ticks % 2 === 1" in lib.replace(" ", "") or "ticks % 2 === 1" in lib,
        "odd fence close",
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
