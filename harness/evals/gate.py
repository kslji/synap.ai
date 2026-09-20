#!/usr/bin/env python3
"""Production go/no-go for the local host. No cloud LLM. Writes last-report.json."""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
HOST_DIR = ROOT / "apps" / "host"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HOST_DIR))

from http_client import get_json  # noqa: E402
from test_guardrails import run_checks as guardrail_checks  # noqa: E402
from test_moss import run_checks as moss_checks  # noqa: E402
from test_reply_repair import run_checks as reply_repair_checks  # noqa: E402
from test_resume_facts import run_checks as resume_facts_checks  # noqa: E402
from test_standalone import run_checks as standalone_checks  # noqa: E402
from test_convert import run_checks as convert_checks  # noqa: E402
from test_chat_markdown import run_checks as chat_markdown_checks  # noqa: E402
from test_general_chat import run_checks as general_chat_checks  # noqa: E402

REPORT = Path(__file__).with_name("last-report.json")
LOOPBACK = ("127.0.0.1", "localhost")


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def loopback_url(url: str | None) -> bool:
    if not url:
        return True
    return any(h in url for h in LOOPBACK)


def main() -> int:
    rows: list[dict] = []
    rows.extend(guardrail_checks())
    rows.extend(moss_checks())
    rows.extend(reply_repair_checks())
    rows.extend(resume_facts_checks())
    rows.extend(standalone_checks())
    rows.extend(convert_checks())
    rows.extend(chat_markdown_checks())
    rows.extend(general_chat_checks())

    try:
        health = get_json("/health")
    except Exception as exc:
        check("host-up", False, str(exc), rows)
        REPORT.write_text(json.dumps({"ok": False, "checks": rows}, indent=2), encoding="utf-8")
        return 1

    check("host-up", True, "127.0.0.1:18765", rows)
    privacy = health.get("privacy") or {}
    check(
        "zero-knowledge-platform-bytes",
        privacy.get("platform_bytes") == 0,
        str(privacy),
        rows,
    )
    moss = health.get("moss") or {}
    check("moss-on-device", bool(moss.get("enabled") or moss.get("backend")), str(moss), rows)

    local = health.get("local_llm") or {}
    backend = local.get("backend")
    url = local.get("url")
    check(
        "local-llm-loopback",
        loopback_url(url),
        f"backend={backend} url={url}",
        rows,
    )
    if backend:
        check(
            "local-llm-not-saas",
            "openai" not in str(url).lower() and "anthropic" not in str(url).lower(),
            str(url),
            rows,
        )

    ram = (health.get("runtime") or {}).get("ram_gb")
    if ram is None:
        ram = (health.get("ram") or {}).get("ram_gb")
    check("ram-reported", isinstance(ram, (int, float)) and ram > 0, str(ram), rows)

    failed = [r for r in rows if not r["ok"]]
    report = {
        "ok": not failed,
        "active_model": health.get("active_model"),
        "local_llm": {"backend": backend, "url": url},
        "checks": rows,
    }
    REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("REPORT", REPORT)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
