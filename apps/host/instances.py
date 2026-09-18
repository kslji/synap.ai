"""User-owned local instances. The global local.ai shell never stores chats."""

from __future__ import annotations

import json
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import ROOT, settings

REG_NAME = "registry.json"
MIGRATE_FILES = (
    "smallcloud.db",
    "moss_local.json",
    "moss_creds.json",
    "vault.wrap.json",
    "vault.device.key",
    "jwt.secret",
    "audit.jsonl",
)


class NoInstanceError(RuntimeError):
    def __init__(self) -> None:
        super().__init__(
            "Create a local instance first. Chats and vault data stay on this machine, not on the global platform."
        )


def home() -> Path:
    if settings.local_ai_home:
        path = Path(settings.local_ai_home).expanduser()
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / "local.ai"
    elif sys.platform == "win32":
        path = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "local.ai"
    else:
        path = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "local.ai"
    path.mkdir(parents=True, exist_ok=True)
    (path / "instances").mkdir(exist_ok=True)
    return path


def _reg_path() -> Path:
    return home() / REG_NAME


def _read_registry() -> dict:
    path = _reg_path()
    if not path.exists():
        return {"version": 1, "active_id": None, "instances": []}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_registry(reg: dict) -> None:
    _reg_path().write_text(json.dumps(reg, indent=2), encoding="utf-8")


def _instance_dir(instance_id: str) -> Path:
    path = home() / "instances" / instance_id
    path.mkdir(parents=True, exist_ok=True)
    (path / "traces").mkdir(exist_ok=True)
    return path


def current() -> dict | None:
    if settings.local_ai_data_dir:
        path = Path(settings.local_ai_data_dir).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        (path / "traces").mkdir(exist_ok=True)
        return {
            "id": "override",
            "name": path.name,
            "created_at": None,
            "data_dir": str(path),
        }
    reg = _read_registry()
    active = reg.get("active_id")
    if not active:
        return None
    for item in reg.get("instances") or []:
        if item.get("id") == active:
            return {**item, "data_dir": str(_instance_dir(active))}
    return None


def current_dir() -> Path | None:
    snap = current()
    return Path(snap["data_dir"]) if snap else None


def require_dir() -> Path:
    path = current_dir()
    if path is None:
        raise NoInstanceError()
    return path


def list_instances() -> list[dict]:
    if settings.local_ai_data_dir:
        item = current()
        return [item] if item else []
    reg = _read_registry()
    active = reg.get("active_id")
    out = []
    for item in reg.get("instances") or []:
        iid = item["id"]
        out.append(
            {
                **item,
                "active": iid == active,
                "data_dir": str(_instance_dir(iid)),
            }
        )
    return out


def create(name: str) -> dict:
    cleaned = " ".join(name.split()).strip()[:60]
    if len(cleaned) < 2:
        raise ValueError("Instance name must be at least 2 characters")
    if settings.local_ai_data_dir:
        raise ValueError("LOCAL_AI_DATA_DIR is set; cannot create another instance")
    iid = str(uuid.uuid4())
    ts = datetime.now(timezone.utc).isoformat()
    _instance_dir(iid)
    meta = {"id": iid, "name": cleaned, "created_at": ts}
    (_instance_dir(iid) / "instance.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    reg = _read_registry()
    reg.setdefault("instances", []).append(meta)
    reg["active_id"] = iid
    _write_registry(reg)
    return {**meta, "data_dir": str(_instance_dir(iid)), "active": True}


def activate(instance_id: str) -> dict:
    if settings.local_ai_data_dir:
        item = current()
        if not item:
            raise ValueError("No data dir override")
        return item
    reg = _read_registry()
    match = next((i for i in reg.get("instances") or [] if i["id"] == instance_id), None)
    if not match:
        raise ValueError("Unknown instance")
    reg["active_id"] = instance_id
    _write_registry(reg)
    return {**match, "data_dir": str(_instance_dir(instance_id)), "active": True}


def snapshot() -> dict:
    return {
        "name": "local.ai",
        "role": "global-shell",
        "stores_user_data": False,
        "user_home": str(home()),
        "instance": current(),
        "instances": list_instances(),
    }


def _folder_listing(root: Path) -> tuple[int, list[dict]]:
    total = 0
    files: list[dict] = []
    if not root.exists():
        return 0, files
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        size = path.stat().st_size
        total += size
        files.append({"path": str(path.relative_to(root)), "bytes": size})
    files.sort(key=lambda f: f["bytes"], reverse=True)
    return total, files[:40]


def storage_report() -> dict:
    inst = current()
    listing = {"bytes": 0, "files": []}
    data_dir = None
    if inst:
        data_dir = Path(inst["data_dir"])
        listing_bytes, files = _folder_listing(data_dir)
        listing = {"bytes": listing_bytes, "files": files}
    return {
        "note": "Browser IndexedDB is not visible to this host. Measure it in the local agent UI.",
        "user_home": str(home()),
        "instance": inst,
        "data_dir": str(data_dir) if data_dir else None,
        "bytes": listing["bytes"],
        "files": listing["files"],
    }


def migrate_repo_data() -> dict | None:
    """Move leftover hackathon data out of the git repo into a user instance."""
    if settings.local_ai_data_dir or list_instances():
        return None
    legacy = ROOT / "data"
    if not legacy.is_dir():
        return None
    has_files = any((legacy / name).exists() for name in MIGRATE_FILES)
    if not has_files:
        return None
    created = create("Migrated from repo")
    dest = Path(created["data_dir"])
    for name in MIGRATE_FILES:
        src = legacy / name
        if src.exists():
            shutil.copy2(src, dest / name)
    moss_session = legacy / "moss_session"
    if moss_session.exists():
        shutil.copytree(moss_session, dest / "moss_session", dirs_exist_ok=True)
    traces = ROOT / "harness" / "traces"
    if traces.is_dir():
        for path in traces.glob("*.json"):
            shutil.copy2(path, dest / "traces" / path.name)
    marker = legacy / "MOVED.txt"
    marker.write_text(
        f"User data moved to {dest}\nThe global platform does not keep chats in this repo.\n",
        encoding="utf-8",
    )
    return created
