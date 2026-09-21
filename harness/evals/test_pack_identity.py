#!/usr/bin/env python3
"""Pack identity + SURF-OPEN labels + shipped pack harness must stay correct."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps" / "web" / "public"
WEB = ROOT / "apps" / "web"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    open_sh = (PUBLIC / "SURF-OPEN.sh").read_text(encoding="utf-8")
    open_bat = (PUBLIC / "SURF-OPEN.bat").read_text(encoding="utf-8")
    html = (PUBLIC / "local-agent.html").read_text(encoding="utf-8")

    check(
        "surf-open-label-uses-modelTitle",
        "d.get('modelTitle')" in open_sh and "agent:-Surf" not in open_sh,
        "SURF-OPEN.sh label_for",
        rows,
    )
    check(
        "surf-open-no-ollama-agent-prefix",
        "${agent:-Surf}" not in open_sh and "d.get('title') or d.get('agent')" not in open_sh,
        "no Ollama · prefix in picker",
        rows,
    )
    check(
        "surf-open-bat-uses-modelTitle",
        "modelTitle" in open_bat and "d.get('title') or '')+' · '" not in open_bat,
        "SURF-OPEN.bat",
        rows,
    )

    check(
        "standalone-hides-light-note",
        "html.standalone #light-note" in html and "lightNote.hidden = true" in html,
        "no re-download banner in packs",
        rows,
    )
    check(
        "standalone-no-upsell-copy",
        "Answers stay short on light models" not in html,
        "upsell string removed from paint path",
        rows,
    )
    check(
        "summarize-wipe-busy-guard",
        "function setActionBusy" in html and "if (actionBusy) return;" in html,
        "double-click guard",
        rows,
    )
    check(
        "mic-recording-states",
        "mic-on" in html and "setMicLive" in html and 'id="mic"' in html,
        "single mic with recording highlight",
        rows,
    )

    harness_dir = PUBLIC / "harness"
    for name in ("TESTS.md", "check-pack.sh", "check-pack.bat", "cases.json"):
        check(f"pack-harness-{name}", (harness_dir / name).is_file(), str(harness_dir / name), rows)

    # Node verify scripts (unique packs + local-agent guards)
    for script, label in (
        ("scripts/verify-packs.mjs", "verify-packs"),
        ("scripts/verify-local-agent.mjs", "verify-local-agent"),
    ):
        path = WEB / script
        if not path.is_file():
            check(label, False, f"missing {path}", rows)
            continue
        try:
            proc = subprocess.run(
                ["node", str(path)],
                cwd=str(WEB),
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            check(label, proc.returncode == 0, (proc.stdout or proc.stderr or "").strip()[-200:], rows)
        except Exception as exc:  # noqa: BLE001
            check(label, False, str(exc), rows)

    # Bake path must include harness files
    open_on = (WEB / "src" / "lib" / "openOnDevice.ts").read_text(encoding="utf-8")
    check(
        "zip-bakes-pack-harness",
        "/harness/check-pack.sh" in open_on or "harness/check-pack.sh" in open_on,
        "openOnDevice includes pack harness",
        rows,
    )
    check(
        "zip-bakes-moss-bridge",
        "moss_bridge.py" in open_on and "moss_vault.enc" in open_on,
        "openOnDevice bakes sealed Moss vault + bridge",
        rows,
    )
    vault = PUBLIC / "moss_vault.enc"
    check("moss-vault-sealed", vault.is_file() and "surf-seal-v1" in vault.read_text(encoding="utf-8"), str(vault), rows)
    check("moss-bridge-present", (PUBLIC / "moss_bridge.py").is_file(), "moss_bridge.py", rows)
    html = (PUBLIC / "local-agent.html").read_text(encoding="utf-8")
    check(
        "standalone-moss-online-only",
        "18767" in html and "navigator.onLine" in html and "searchMossPack" in html,
        "pack chat uses Moss bridge only while online",
        rows,
    )
    check(
        "standalone-no-plaintext-moss-key",
        "MOSS_PROJECT_KEY" not in html and "MOSS_PROJECT_ID" not in html,
        "UI must not embed Moss env keys",
        rows,
    )

    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
