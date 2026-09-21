#!/usr/bin/env python3
"""Named-file grounding: ask mentioning harbour must not dump a sibling résumé.

Mirrors apps/web filesNamedInAsk + retrieveFileContext / pack retrieveFiles focus.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CASES = HERE / "file_focus_cases.json"
GROUNDED = ROOT / "apps" / "web" / "src" / "lib" / "groundedContext.ts"
LOCAL_CHAT = ROOT / "apps" / "web" / "src" / "components" / "LocalChat.tsx"
PACK_HTML = ROOT / "apps" / "web" / "public" / "local-agent.html"

SKIP_STEM = re.compile(
    r"^(pdf|txt|doc|docx|zip|json|md|csv|xls|xlsx|pptx|file|the|and|for)$"
)
OVERVIEW_ASK = re.compile(
    r"\b(summar(y|ise|ize)?|overview|diagram|visuali[sz]e|folder (tree|structure)|"
    r"mermaid|explain (the |this )?(project|repo|zip)|what is this (project|zip|repo|code|file)|"
    r"interview|walk (me )?through|brief me|what(?:'s| is| does)\s+(this|it)|this file|"
    r"tell me|about|consist|include[sd]?)\b",
    re.I,
)


def file_stem_tokens(name: str) -> list[str]:
    base = str(name or "").replace("\\", "/").split("/")[-1]
    stem = re.sub(r"\.[^.]+$", "", base)
    return [
        w
        for w in re.split(r"[^a-z0-9]+", stem.lower())
        if len(w) >= 3 and not SKIP_STEM.match(w)
    ]


def files_named_in_ask(files: list[dict], query: str) -> list[dict]:
    q = str(query or "").lower()
    if not q or not files:
        return []
    hits = []
    for f in files:
        tokens = file_stem_tokens(f["name"])
        if not tokens:
            continue
        full = str(f["name"]).replace("\\", "/").split("/")[-1].lower()
        stem = re.sub(r"\.[^.]+$", "", full)
        if len(stem) >= 5 and stem in q:
            hits.append(f)
            continue
        for t in tokens:
            if len(t) >= 4:
                if t in q:
                    hits.append(f)
                    break
            elif re.search(rf"\b{re.escape(t)}\b", q):
                hits.append(f)
                break
    return hits


def focus_context(files: list[dict], query: str, budget: int = 8000) -> str:
    """Minimal mirror of pack retrieveFiles / retrieveFileContext scoping."""
    usable = [f for f in files if str(f.get("text") or "").strip()]
    named = files_named_in_ask(usable, query)
    focus = named if named else usable
    note = ""
    if named:
        names = ", ".join(f["name"] for f in named)
        note = (
            f"FOCUS: The user named specific file(s): {names}. "
            "Answer from those file(s) only. Do not dump unrelated attachments.\n\n"
        )
    heads = "\n\n".join(
        f"### {f['name']}\n{str(f['text'])[: min(budget, 18000)]}" for f in focus
    )
    if OVERVIEW_ASK.search(query or "") and focus:
        return (note + heads)[:budget]
    return (note + heads)[:budget]


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    grounded = GROUNDED.read_text(encoding="utf-8") if GROUNDED.exists() else ""
    html = PACK_HTML.read_text(encoding="utf-8") if PACK_HTML.exists() else ""
    chat = LOCAL_CHAT.read_text(encoding="utf-8") if LOCAL_CHAT.exists() else ""

    check(
        "source-filesNamedInAsk-ts",
        "filesNamedInAsk" in grounded and "FOCUS: The user named specific file(s)" in grounded,
        str(GROUNDED),
        rows,
    )
    check(
        "source-filesNamedInAsk-pack",
        "filesNamedInAsk" in html and "FOCUS: The user named specific file(s)" in html,
        str(PACK_HTML),
        rows,
    )
    check(
        "source-localchat-scopes-named",
        "filesNamedInAsk" in chat and "scoped" in chat,
        "LocalChat uses filesNamedInAsk before retrieve/overview",
        rows,
    )

    data = json.loads(CASES.read_text(encoding="utf-8"))
    for case in data.get("cases") or []:
        cid = case["id"]
        files = case["files"]
        query = case["query"]
        named = files_named_in_ask(files, query)
        expect = case.get("expect_named") or []
        got_names = [f["name"] for f in named]
        check(
            f"file-focus-named:{cid}",
            got_names == expect,
            f"got={got_names} expect={expect}",
            rows,
        )
        ctx = focus_context(files, query)
        must = case.get("must_contain_any") or []
        must_not = case.get("must_not_contain_any") or []
        ok_must = (not must) or any(m.lower() in ctx.lower() for m in must)
        ok_not = all(m.lower() not in ctx.lower() for m in must_not)
        check(
            f"file-focus-ctx:{cid}",
            ok_must and ok_not,
            f"must={must} must_not={must_not} ctx_head={ctx[:120]!r}",
            rows,
        )

    # Regression: bare "about" with a named token must not pull the résumé.
    resume_blob = "KABIR SINGH LAMBA PROFESSIONAL EXPERIENCE Park+"
    harbour_blob = "HARBOUR_AGENT_README local agent pack"
    ctx = focus_context(
        [
            {"name": "Kabir_Singh_Lamba_Resume.pdf", "text": resume_blob},
            {"name": "harbour-agent-OP1.zip", "text": harbour_blob},
        ],
        "what is harbour file is about",
    )
    check(
        "file-focus-regression-harbour-about",
        "HARBOUR_AGENT" in ctx and "KABIR SINGH" not in ctx and "FOCUS:" in ctx,
        "named harbour + about → harbour only",
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
