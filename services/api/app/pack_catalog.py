"""Pack catalog and short-lived download URLs.

PACK_BACKEND=file reads PACK_ROOT (dev and the self-test).
PACK_BACKEND=s3 returns a presigned R2/S3 URL when those env vars are set.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from pathlib import Path

ENV = os.environ


def pack_root() -> Path:
    raw = ENV.get("PACK_ROOT", "")
    return Path(raw) if raw else Path(__file__).resolve().parents[1] / "packs"


def _sign(path: str, exp: int) -> str:
    secret = ENV.get("JWT_SECRET", "")
    return hmac.new(secret.encode(), f"{path}:{exp}".encode(), hashlib.sha256).hexdigest()


def signed_file_url(base: str, rel: str, ttl_s: int = 900) -> str:
    exp = int(time.time()) + ttl_s
    sig = _sign(rel, exp)
    return f"{base.rstrip('/')}/v1/packs/download?path={rel}&exp={exp}&sig={sig}"


def verify_download(path: str, exp: int, sig: str, now: int | None = None) -> Path:
    now = int(time.time()) if now is None else now
    if exp < now or not hmac.compare_digest(_sign(path, exp), sig):
        raise ValueError("bad signature")
    rel = Path(path)
    if rel.is_absolute() or ".." in rel.parts:
        raise ValueError("bad path")
    full = (pack_root() / rel).resolve()
    root = pack_root().resolve()
    if root not in full.parents and full != root:
        raise ValueError("bad path")
    if not full.is_file():
        raise ValueError("missing")
    return full


def _versions(pack_dir: Path) -> list[tuple[str, Path]]:
    found = []
    if not pack_dir.is_dir():
        return found
    for child in pack_dir.iterdir():
        if (child / "manifest.json").is_file():
            found.append((child.name, child))
    found.sort(key=lambda item: item[0])
    return found


def catalog(base_url: str, installed: str = "") -> dict:
    have = {}
    for part in installed.split(","):
        if "@" in part:
            pack_id, version = part.split("@", 1)
            have[pack_id] = version
    packs = []
    root = pack_root()
    if root.is_dir():
        for pack_dir in sorted(p for p in root.iterdir() if p.is_dir()):
            versions = _versions(pack_dir)
            if not versions:
                continue
            version, folder = versions[-1]
            manifest = json.loads((folder / "manifest.json").read_text())
            files = _bundle(folder, pack_dir.name, version, base_url, manifest)
            previous = have.get(pack_dir.name)
            changed = files
            if previous and previous != version:
                prev_dir = pack_dir / previous
                prev_manifest_path = prev_dir / "manifest.json"
                if prev_manifest_path.is_file():
                    old_manifest = json.loads(prev_manifest_path.read_text())
                    old = _hashes(prev_dir, old_manifest)
                    changed = [row for row in files if old.get(row["name"]) != row["sha256"]]
            packs.append({
                "id": manifest.get("pack_id") or pack_dir.name,
                "title": manifest.get("title") or pack_dir.name,
                "niche": manifest.get("niche") or "general",
                "latest": {"version": version, "files": files},
                "installed": previous,
                "update_available": previous is not None and previous != version,
                "changed_files": [row["name"] for row in changed] if previous else [row["name"] for row in files],
                "delta": None,
            })
    return {"packs": packs}


def _bundle(folder: Path, pack_name: str, version: str, base_url: str, manifest: dict) -> list[dict]:
    rows = []
    for name in ("manifest.json", "manifest.sig"):
        path = folder / name
        if not path.is_file():
            continue
        data = path.read_bytes()
        rel = f"{pack_name}/{version}/{name}"
        rows.append({
            "name": name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "url": _file_url(base_url, rel, {}),
        })
    for item in manifest.get("files", []):
        rel = f"{pack_name}/{version}/{item['name']}"
        rows.append({
            "name": item["name"],
            "sha256": item["sha256"],
            "size": item["size"],
            "url": _file_url(base_url, rel, item),
        })
    return rows


def _hashes(folder: Path, manifest: dict) -> dict[str, str]:
    found: dict[str, str] = {}
    for name in ("manifest.json", "manifest.sig"):
        path = folder / name
        if path.is_file():
            found[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    for item in manifest.get("files", []):
        found[item["name"]] = item["sha256"]
    return found


def _file_url(base_url: str, rel: str, item: dict) -> str:
    if ENV.get("PACK_BACKEND") == "s3":
        signed = _s3_url(rel)
        if signed:
            return signed
    return signed_file_url(base_url, rel)


def _s3_url(rel: str) -> str | None:
    bucket = ENV.get("R2_BUCKET") or ENV.get("S3_BUCKET")
    if not bucket:
        return None
    import boto3
    client = boto3.client(
        "s3",
        endpoint_url=ENV.get("R2_ENDPOINT") or ENV.get("S3_ENDPOINT"),
        aws_access_key_id=ENV.get("R2_ACCESS_KEY_ID") or ENV.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=ENV.get("R2_SECRET_ACCESS_KEY") or ENV.get("AWS_SECRET_ACCESS_KEY"),
        region_name=ENV.get("S3_REGION", "auto"),
    )
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": rel},
        ExpiresIn=900,
    )
