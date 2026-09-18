#!/usr/bin/env python3
"""Local harness smoke: profile JWT, Moss, optional local LLM chat cases."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from http_client import get_json, post_json, stream_chat  # noqa: E402

CASES = HERE / "cases.json"


def main() -> int:
    try:
        health = get_json("/health")
    except Exception as exc:
        print(f"FAIL host down: {exc}")
        print("Start: python -m uvicorn main:app --app-dir apps/host --host 127.0.0.1 --port 18765")
        return 1

    print(
        "PASS /health",
        json.dumps(
            {
                k: health.get(k)
                for k in ("ok", "ollama", "active_model", "local_llm", "moss", "livekit", "privacy")
            }
        ),
    )
    if not (health.get("platform") or {}).get("instance"):
        created = post_json("/v1/instances", {"name": "harness"})
        print("PASS /v1/instances", created.get("data_dir"))
        health = get_json("/health")
    inst = (health.get("platform") or {}).get("instance") or {}
    email = "harness-smoke@example.com"
    password = "harness-pass-1"
    token = None
    try:
        post_json("/v1/auth/register", {"email": email, "password": password})
        print("PASS /v1/auth/register")
    except urllib.error.HTTPError as exc:
        if exc.code != 409:
            print("FAIL /v1/auth/register", exc.read()[:200])
            return 1
        print("PASS /v1/auth/register (exists)")
        try:
            logged = post_json("/v1/auth/login", {"email": email, "password": password})
            token = logged["token"]
        except urllib.error.HTTPError:
            post_json("/v1/auth/resend-otp", {"email": email, "purpose": "verify"})
    if token is None:
        outbox = Path(inst.get("data_dir") or ".") / "mail-outbox.jsonl"
        if not outbox.exists():
            print("FAIL mail queue outbox missing", outbox)
            return 1
        last = json.loads(outbox.read_text(encoding="utf-8").strip().splitlines()[-1])
        match = re.search(r"\b(\d{6})\b", last.get("body") or "")
        if not match:
            print("FAIL OTP not in queued mail body")
            return 1
        verified = post_json("/v1/auth/verify-email", {"email": email, "otp": match.group(1)})
        token = verified["token"]
        print("PASS /v1/auth/verify-email")
    else:
        print("PASS /v1/auth/login")
    fb = post_json(
        "/v1/feedback",
        {
            "rating": "down",
            "title": "Harness check",
            "message": "Smoke test: thumbs down with a title so we can inspect SQLite.",
            "engine": "ollama",
        },
        token=token,
    )
    listed = get_json("/v1/feedback?limit=5", token=token)
    if fb.get("id") and any(row.get("id") == fb["id"] for row in listed.get("items", [])):
        print("PASS /v1/feedback", fb["id"])
    else:
        print("FAIL /v1/feedback")
        return 1
    try:
        unique = "HARNESS-DOC-ZX9 QUOKKA-771 Northwind never appears in product README."
        post_json("/v1/memory", {"id": "file-harness-quokka.txt", "text": unique}, token=token)
        mem = get_json("/v1/memory/search?q=QUOKKA-771", token=token)
        blob = " ".join(str(d.get("text") or "") for d in mem.get("docs") or [])
        leaks = [
            "Small Cloud keeps chat on-device",
            "static host never receives prompts",
            "Whisper is not loaded in the UI",
        ]
        leaked = [p for p in leaks if p.lower() in blob.lower()]
        if "QUOKKA-771" not in blob or leaked:
            print("FAIL moss search grounded", "leaks=", leaked, "blob=", blob[:200])
            return 1
        empty = get_json("/v1/memory/search?q=Kepler-186f-orbital-period", token=token)
        empty_blob = " ".join(str(d.get("text") or "") for d in empty.get("docs") or [])
        leaked_empty = [p for p in leaks if p.lower() in empty_blob.lower()]
        if leaked_empty:
            print("FAIL moss search leaked product copy on unrelated query", leaked_empty)
            return 1
        print("PASS moss search", mem.get("backend"), mem.get("time_taken_ms"), "ms")
    except Exception as exc:
        print("FAIL moss search", exc)
        return 1

    local = (health.get("local_llm") or {}).get("backend") or health.get("ollama")
    if not local:
        print("WARN no local LLM (Ollama / LM Studio / llama.cpp) — chat cases skipped")
        return 0

    failed = 0
    for case in json.loads(CASES.read_text()):
        text, meta = stream_chat(token, case["prompt"])
        needles = [n.lower() for n in case.get("expect_contains_any") or []]
        banned = [n.lower() for n in case.get("expect_not_contains_any") or []]
        ok = (not needles or any(n in text.lower() for n in needles)) and not any(
            b in text.lower() for b in banned
        )
        print(("PASS" if ok else "FAIL"), case["id"], f"({len(text)} chars)", meta.get("llm_backend") or meta.get("model"))
        if not ok:
            print("  got:", text[:240].replace("\n", " "))
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
