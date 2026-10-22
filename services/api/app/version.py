"""Single source of truth for the Surf app version.

The canonical value lives in the repo-root ``VERSION`` file. ``apps/desktop``
and the surf-ide extension manifest mirror it, and a drift-guard test
(``tests/test_version.py``) keeps those in step.

Two lookup paths, because the API runs from two layouts:
  * monorepo (dev, CI, tests) — the repo-root ``VERSION`` file is present;
  * container (built from the ``services/api`` context) — there is no repo root
    next to the image, so operators set ``APP_VERSION`` in the environment.

Precedence is explicit override first (``APP_VERSION``), then the ``VERSION``
file, then a visible dev sentinel.
"""
from __future__ import annotations

import os
import pathlib

_HERE = pathlib.Path(__file__).resolve()
# <repo>/services/api/app/version.py → parents[3] is the repo root.
_REPO_ROOT = _HERE.parents[3]


def _from_file() -> str | None:
    for candidate in (_REPO_ROOT / "VERSION", _HERE.parents[1] / "VERSION"):
        try:
            value = candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value
    return None


def app_version() -> str:
    """Resolve the running app version, e.g. ``0.2.0``."""
    return os.environ.get("APP_VERSION", "").strip() or _from_file() or "0.0.0-dev"
