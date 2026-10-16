#!/usr/bin/env python3
"""Generate a dev Ed25519 keypair for licence signing.

Prints LICENCE_SIGNING_KEY_HEX once. The seed is not written into the repo.
The matching public key is written to apps/desktop/resources/licence-public.json
so a development build can verify licences from an API that has this seed.

Run from the repository root:

    python services/api/scripts/licence_keypair.py

Put the printed hex in the API environment (deploy/.env, which is gitignored).
Do not commit it. Re-run this script to rotate the pair, then ship the new
public file in the desktop build.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from nacl.signing import SigningKey

ROOT = Path(__file__).resolve().parents[3]
PUBLIC = ROOT / "apps" / "desktop" / "resources" / "licence-public.json"
KEY_ID = "lic-2026-1"


def main() -> None:
    key = SigningKey.generate()
    public = key.verify_key.encode().hex()
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.write_text(json.dumps({"keys": {KEY_ID: public}}, indent=2) + "\n", encoding="utf-8")
    seed = key.encode().hex()
    print(f"Wrote public key {KEY_ID} to {PUBLIC.relative_to(ROOT)}")
    print("Set this in the API environment only. Do not commit it.")
    print(f"LICENCE_SIGNING_KEY_HEX={seed}")
    print(f"LICENCE_KEY_ID={KEY_ID}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
