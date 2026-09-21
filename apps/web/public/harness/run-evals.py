#!/usr/bin/env python3
"""Run pack-local evals: guardrails + Moss default path. No network required."""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from guardrails import sanitize_user_text  # noqa: E402
from file_focus import run_file_focus  # noqa: E402


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(("PASS" if ok else "FAIL"), name, detail)
    return ok


def run_guardrails() -> list[bool]:
    cases = json.loads((HERE / "guardrail_cases.json").read_text(encoding="utf-8"))
    results = []
    for case in cases:
        cleaned, flags = sanitize_user_text(case["text"])
        expect = set(case.get("expect_flags") or [])
        ok_flags = set(flags) == expect
        ok_text = case["must_contain"].lower() in cleaned.lower()
        ok = ok_flags and ok_text
        results.append(
            check(
                f"guardrail:{case['id']}",
                ok,
                f"flags={flags} expect={sorted(expect)}",
            )
        )
        if not ok:
            print("  cleaned:", cleaned[:160])
    return results


def run_moss_default() -> list[bool]:
    results = []
    vault = ROOT / "moss_vault.enc"
    bridge = ROOT / "moss_bridge.py"
    results.append(check("moss-vault", vault.is_file() and "surf-seal-v1" in vault.read_text(encoding="utf-8")))
    results.append(check("moss-bridge", bridge.is_file()))
    if not bridge.is_file():
        return results
    import importlib.util
    import tempfile

    spec = importlib.util.spec_from_file_location("pack_moss_bridge", bridge)
    mb = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mb)
    pid, key = mb.unseal_vault(vault)
    results.append(check("moss-unseal", isinstance(pid, str) and isinstance(key, str)))
    with tempfile.TemporaryDirectory() as tmp:
        from pathlib import Path as P

        t = P(tmp)
        mb.HERE = t
        mb.DOCS_PATH = t / "moss_local.json"
        mb._docs = []
        mb._client = None
        mb._backend = "keyword-fallback"
        mb.add_doc("t1", "Invoice INV-100 bakery flour total 50 USD")
        hit = mb.query("bakery invoice flour", local_only=True)
        texts = " ".join(str(d.get("text") or "") for d in hit.get("docs") or [])
        results.append(
            check(
                "moss-default-search",
                "invoice" in texts.lower() and hit.get("backend") == "moss-local-session-fallback",
                str(hit.get("backend")),
            )
        )
    return results


def run_identity() -> list[bool]:
    results = []
    agent = ROOT / "agent.json"
    if not agent.is_file():
        results.append(check("agent.json", True, "skipped (not a baked pack folder)"))
    else:
        results.append(check("agent.json", True))
        data = json.loads(agent.read_text(encoding="utf-8"))
        results.append(check("model-tag", bool(data.get("model"))))
        results.append(check("model-title", bool(data.get("modelTitle"))))
    html = (ROOT / "local-agent.html").read_text(encoding="utf-8") if (ROOT / "local-agent.html").is_file() else ""
    results.append(check("runtime-sanitize", "sanitizeUserText" in html and "[blocked-instruction]" in html))
    results.append(check("runtime-secret-redact", "[redacted-key]" in html))
    results.append(check("runtime-pem-redact", "[redacted-private-key]" in html))
    return results


def main() -> int:
    print("Surf pack evals (guardrails + Moss + identity + file-focus)")
    print("Folder:", ROOT)
    print()
    bits = []
    bits.extend(run_identity())
    bits.extend(run_guardrails())
    bits.extend(run_moss_default())
    bits.extend(run_file_focus(check))
    passed = sum(1 for b in bits if b)
    failed = sum(1 for b in bits if not b)
    print()
    print(f"Pack evals: {passed} passed, {failed} failed.")
    if failed:
        print("Fix issues or re-download the pack from synap.surf/download.")
        return 1
    print("Default guardrails + Moss + named-file grounding look healthy.")
    print("Next: customize harness/custom_cases.json and run bash harness/run-custom.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
