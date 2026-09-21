"""Pack-local named-file grounding checks (no network, no model)."""

from __future__ import annotations

import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CASES = HERE / "file_focus_cases.json"

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


def run_file_focus(check) -> list[bool]:
    """`check(name, ok, detail='') -> bool` printer from run-evals."""
    results: list[bool] = []
    html_path = ROOT / "local-agent.html"
    html = html_path.read_text(encoding="utf-8") if html_path.is_file() else ""
    results.append(
        check(
            "file-focus-runtime",
            "filesNamedInAsk" in html and "FOCUS: The user named specific file(s)" in html,
            "local-agent.html scopes named attachments",
        )
    )
    if not CASES.is_file():
        results.append(check("file-focus-cases", False, "file_focus_cases.json missing"))
        return results
    data = json.loads(CASES.read_text(encoding="utf-8"))
    for case in data.get("cases") or []:
        cid = case["id"]
        files = case["files"]
        query = case["query"]
        named = files_named_in_ask(files, query)
        expect = case.get("expect_named") or []
        got = [f["name"] for f in named]
        results.append(check(f"file-focus-named:{cid}", got == expect, f"got={got}"))
        ctx = focus_context(files, query)
        must = case.get("must_contain_any") or []
        must_not = case.get("must_not_contain_any") or []
        ok_must = (not must) or any(m.lower() in ctx.lower() for m in must)
        ok_not = all(m.lower() not in ctx.lower() for m in must_not)
        results.append(
            check(
                f"file-focus-ctx:{cid}",
                ok_must and ok_not,
                f"must={must} must_not={must_not}",
            )
        )
    return results
