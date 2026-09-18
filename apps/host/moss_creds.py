from __future__ import annotations

import json

from config import settings
from instances import current_dir, require_dir


def _creds_path():
    root = current_dir()
    return None if root is None else root / "moss_creds.json"


def load_creds() -> tuple[str, str]:
    pid, key = settings.moss_project_id, settings.moss_project_key
    path = _creds_path()
    if path and path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        pid = data.get("project_id") or pid
        key = data.get("project_key") or key
    return pid, key


def save_creds(project_id: str, project_key: str) -> None:
    path = require_dir() / "moss_creds.json"
    path.write_text(
        json.dumps({"project_id": project_id, "project_key": project_key}),
        encoding="utf-8",
    )
    path.chmod(0o600)
