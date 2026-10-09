import hashlib
import json
import os
from urllib.parse import urlsplit

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["SEARXNG_URL"] = "http://stub.local/search"
os.environ["MAIL_MODE"] = "console"
os.environ["FETCH_ALLOW_HOSTS"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def _login(client: TestClient) -> str:
    started = client.post("/v1/auth/otp/start", json={"email": "packs@example.com"})
    assert started.status_code == 200, started.text
    verified = client.post("/v1/auth/otp/verify", json={
        "email": "packs@example.com",
        "code": started.json()["dev_code"],
        "device": {"device_uid": "pack-box", "name": "Pack", "os": "linux"},
    })
    assert verified.status_code == 200, verified.text
    return verified.json()["access_token"]


def _write(folder, body: bytes) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "pack.sqlite").write_bytes(body)
    manifest = {
        "pack_id": "general-starter",
        "title": "General starter",
        "niche": "general",
        "files": [{"name": "pack.sqlite", "sha256": hashlib.sha256(body).hexdigest(), "size": len(body)}],
    }
    (folder / "manifest.json").write_text(json.dumps(manifest))
    (folder / "manifest.sig").write_bytes(b"sig-bytes")


def test_pack_catalog_reports_changed_files(tmp_path, monkeypatch):
    monkeypatch.setenv("PACK_ROOT", str(tmp_path))
    monkeypatch.setenv("PACK_BACKEND", "file")
    _write(tmp_path / "general-starter" / "2026.10.01", b"old-pack")
    _write(tmp_path / "general-starter" / "2026.10.09", b"new-pack")
    with TestClient(app) as client:
        token = _login(client)
        denied = client.get("/v1/packs")
        assert denied.status_code == 401
        listed = client.get("/v1/packs", params={"installed": "general-starter@2026.10.01"}, headers={"authorization": f"Bearer {token}"})
        assert listed.status_code == 200, listed.text
        pack = listed.json()["packs"][0]
        assert pack["update_available"] is True
        assert pack["latest"]["version"] == "2026.10.09"
        assert "pack.sqlite" in pack["changed_files"]
        assert "manifest.json" in pack["changed_files"]
        url = next(row["url"] for row in pack["latest"]["files"] if row["name"] == "pack.sqlite")
        parts = urlsplit(url)
        downloaded = client.get(f"{parts.path}?{parts.query}")
        assert downloaded.status_code == 200
        assert downloaded.content == b"new-pack"
