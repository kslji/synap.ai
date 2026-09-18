from __future__ import annotations

import json
from datetime import datetime, timezone

from instances import current_dir, require_dir


def _log_path():
    root = current_dir()
    return None if root is None else root / "audit.jsonl"


def append(event: str, detail: dict | None = None) -> None:
    path = _log_path()
    if path is None:
        return
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "detail": detail or {},
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")


def tail(limit: int = 40) -> list[dict]:
    path = _log_path()
    if path is None or not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    out = []
    for line in lines:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out
