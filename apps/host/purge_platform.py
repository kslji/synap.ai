#!/usr/bin/env python3
"""Purge VPS platform ephemera older than 24h. Safe to run via cron/systemd timer.

  cd apps/host && .venv/bin/python purge_platform.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from platform_store import purge_ephemeral  # noqa: E402


def main() -> int:
    result = purge_ephemeral(24)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
