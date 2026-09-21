#!/usr/bin/env python3
"""Downloaded packs must ship Moss by default: sealed vault + online-only bridge.

Proves the default path works without exposing plaintext keys:
  - moss_vault.enc is sealed (surf-seal-v1)
  - moss_bridge unseals, indexes, and keyword-searches locally
  - LOCAL-SETUP only starts the bridge when online
  - local-agent skips Moss when offline
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "apps" / "web" / "public"


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def _load_bridge():
    path = PUBLIC / "moss_bridge.py"
    spec = importlib.util.spec_from_file_location("surf_moss_bridge", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run_checks() -> list[dict]:
    rows: list[dict] = []
    vault = PUBLIC / "moss_vault.enc"
    bridge_py = PUBLIC / "moss_bridge.py"
    setup_sh = PUBLIC / "LOCAL-SETUP.sh"
    setup_bat = PUBLIC / "LOCAL-SETUP.bat"
    html = (PUBLIC / "local-agent.html").read_text(encoding="utf-8")

    check("pack-moss-vault-file", vault.is_file(), str(vault), rows)
    check("pack-moss-bridge-file", bridge_py.is_file(), str(bridge_py), rows)

    if not vault.is_file() or not bridge_py.is_file():
        return rows

    sealed = vault.read_text(encoding="utf-8")
    check("pack-moss-vault-alg", "surf-seal-v1" in sealed, "alg=surf-seal-v1", rows)
    check(
        "pack-moss-vault-no-plaintext",
        "MOSS_PROJECT_KEY" not in sealed and '"project_key": "' not in sealed,
        "no plaintext project_key in vault file",
        rows,
    )

    try:
        blob = json.loads(sealed)
        check(
            "pack-moss-vault-shape",
            isinstance(blob, dict) and all(k in blob for k in ("v", "alg", "nonce", "ct", "mac")),
            str(sorted(blob.keys())),
            rows,
        )
    except Exception as exc:  # noqa: BLE001
        check("pack-moss-vault-shape", False, str(exc), rows)

    mb = _load_bridge()
    pid, key = mb.unseal_vault(vault)
    check(
        "pack-moss-unseal-default",
        isinstance(pid, str) and isinstance(key, str),
        "unseal returns strings (may be empty without deploy keys)",
        rows,
    )
    check(
        "pack-moss-unseal-no-leak",
        "MOSS_" not in pid and "MOSS_" not in key,
        "unsealed values are not env-var names",
        rows,
    )

    # Default working path: keyword index/search without Moss SDK credits.
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        docs_path = tmp_path / "moss_local.json"
        # Point bridge storage at temp dir for isolation.
        mb.HERE = tmp_path
        mb.DOCS_PATH = docs_path
        mb.VAULT = vault
        mb._docs = []
        mb._client = None
        mb._backend = "keyword-fallback"

        mb.add_doc("file-invoice.txt", "Northwind invoice total due 1250 USD for bakery flour order.")
        mb.add_doc("file-notes.txt", "Team standup notes about shipping the Surf pack.")
        check("pack-moss-default-index", docs_path.is_file() and len(mb._docs) == 2, f"docs={len(mb._docs)}", rows)

        hit = mb.query("invoice bakery flour total", local_only=True)
        texts = " ".join(str(d.get("text") or "") for d in hit.get("docs") or [])
        check(
            "pack-moss-default-search-hit",
            hit.get("backend") == "moss-local-session-fallback"
            and "invoice" in texts.lower()
            and hit.get("hits", 0) >= 1,
            str(hit.get("backend")),
            rows,
        )

        empty = mb.query("quantum astrophysics zebra", local_only=True)
        check(
            "pack-moss-default-search-empty",
            empty.get("backend") == "moss-local-session-fallback" and (empty.get("hits") or 0) == 0,
            f"hits={empty.get('hits')}",
            rows,
        )

        # Online path may try SDK; with empty vault it must still fall back safely.
        online = mb.query("invoice bakery", local_only=False)
        check(
            "pack-moss-online-fallback-safe",
            online.get("backend") in ("moss", "moss-local-session-fallback")
            and isinstance(online.get("docs"), list),
            str(online.get("backend")),
            rows,
        )

    setup = setup_sh.read_text(encoding="utf-8")
    check(
        "pack-setup-starts-moss-online",
        "start_moss_bridge" in setup and "online_now" in setup and "moss_bridge.py" in setup,
        "LOCAL-SETUP.sh starts bridge when online",
        rows,
    )
    check(
        "pack-setup-skips-moss-offline",
        "Offline — Moss paused" in setup or "Moss paused" in setup,
        "LOCAL-SETUP.sh pauses Moss offline",
        rows,
    )
    bat = setup_bat.read_text(encoding="utf-8")
    check(
        "pack-setup-bat-moss",
        "moss_bridge.py" in bat and "moss_vault.enc" in bat,
        "LOCAL-SETUP.bat includes Moss bridge",
        rows,
    )

    check(
        "pack-agent-moss-online-gate",
        "if (!navigator.onLine) return" in html or "!navigator.onLine" in html,
        "local-agent gates Moss on navigator.onLine",
        rows,
    )
    check(
        "pack-agent-moss-search-wired",
        "searchMossPack" in html and "formatMossHits" in html and "18767" in html,
        "chat sends Moss hits into the prompt when online",
        rows,
    )
    check(
        "pack-agent-index-moss-standalone",
        "isStandalone()" in html and "18767/v1/memory" in html,
        "standalone indexes into pack Moss bridge",
        rows,
    )

    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
