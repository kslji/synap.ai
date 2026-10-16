"""Signed encrypted pack deltas. Keys in this file are test keys, not production keys."""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ.setdefault("SURF_API_LITE", "1")
os.environ.setdefault("SEARXNG_URL", "http://stub.local/search")
os.environ.setdefault("MAIL_MODE", "console")

from nacl.signing import SigningKey

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services" / "packs"))

from build_delta import (  # noqa: E402
    decrypt,
    fixture_embed,
    parse_arxiv,
    parse_feed,
    parse_hf,
    parse_rss,
    parse_sitemap,
    verify_delta,
    write_pack,
    build_sqlite,
)

SIGNING = "11" * 32
CONTENT = "22" * 32
PUBLIC = SigningKey(bytes.fromhex(SIGNING)).verify_key.encode().hex()

SITEMAP = """<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/harbor</loc><lastmod>2026-10-16</lastmod></url>
</urlset>
"""
RSS = """<?xml version="1.0"?>
<rss><channel><item><title>Harbor notice</title><link>https://example.com/notice</link><description>Pier 4</description></item></channel></rss>
"""
ARXIV = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Gemma</title><id>https://arxiv.org/abs/1</id><summary>vectors</summary><published>2026-10-01T00:00:00Z</published></entry></feed>
"""


def test_feed_parsers_read_sitemap_rss_arxiv_and_huggingface():
    assert parse_sitemap(SITEMAP)[0]["url"] == "https://example.com/harbor"
    assert parse_rss(RSS)[0]["title"] == "Harbor notice"
    assert parse_arxiv(ARXIV)[0]["url"] == "https://arxiv.org/abs/1"
    rows = parse_hf([{"id": "google/embeddinggemma-2", "pipeline_tag": "feature-extraction", "lastModified": "2026-10-01"}])
    assert rows[0]["url"] == "https://huggingface.co/google/embeddinggemma-2"
    assert parse_feed("sitemap", SITEMAP)[0]["published"] == "2026-10-16"


def test_delta_is_signed_encrypted_and_256_d(tmp_path: Path):
    items = parse_sitemap(SITEMAP) + parse_rss(RSS)
    plaintext = build_sqlite(items, fixture_embed)
    out = tmp_path / "news-delta" / "2026.10.16"
    write_pack(out, "news-delta", "News delta", "general", "2026.10.16", "2026.10.01", plaintext, CONTENT, SIGNING, "k-test", True)
    checked = verify_delta(out, PUBLIC, CONTENT)
    assert checked["chunks"] == 2
    assert checked["dim"] == 256
    assert checked["embedding_bytes"] == 256 * 4
    assert checked["fixture_embed"] is True
    blob = (out / "delta.sqlite.enc").read_bytes()
    raw = decrypt(blob, CONTENT)
    assert raw[:15] == b"SQLite format 3"
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["embedding"]["dim"] == 256
    assert manifest["files"][0]["name"] == "delta.sqlite.enc"
    assert "11" * 8 not in (out / "manifest.json").read_text()


def test_updates_endpoint_advertises_the_delta(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    monkeypatch.setenv("PACK_ROOT", str(tmp_path))
    monkeypatch.setenv("PACK_BACKEND", "file")
    items = parse_rss(RSS)
    plaintext = build_sqlite(items, fixture_embed)
    out = tmp_path / "news-delta" / "2026.10.16"
    write_pack(out, "news-delta", "News delta", "general", "2026.10.16", None, plaintext, CONTENT, SIGNING, "k-test", True)
    from app.main import app
    with TestClient(app) as client:
        started = client.post("/v1/auth/otp/start", json={"email": "delta@example.com"})
        token = client.post("/v1/auth/otp/verify", json={
            "email": "delta@example.com",
            "code": started.json()["dev_code"],
            "device": {"device_uid": "delta-box", "name": "Delta", "os": "linux"},
        }).json()["access_token"]
        listed = client.get("/v1/packs/updates", params={"installed": "news-delta@2026.10.01"}, headers={"authorization": f"Bearer {token}"})
        assert listed.status_code == 200, listed.text
        body = listed.json()
        assert body["stub"] is False
        pack = body["packs"][0]
        assert pack["delta"]["name"] == "delta.sqlite.enc"
        assert pack["delta"]["sha256"]
        assert "delta.sqlite.enc" in pack["changed_files"]
        assert listed.json()["content_key_sealed"] is None


WRAP_VECTOR = "454fcd9de400b49b00a2f9bd8b99f5b27f1bbc93991e914d121ccb62e7a1a183"
VECTOR_LICENCE = "11111111-1111-4111-8111-111111111111"
VECTOR_DEVICE = "cd" * 32


def test_embed_api_key_equals_form_accepts_a_leading_dash():
    """argparse treats a separate token that starts with '-' as a new flag."""
    import subprocess
    script = ROOT / "services" / "packs" / "build_pack.py"
    separate = subprocess.run([sys.executable, str(script), "--api-key", "-dash"], capture_output=True, text=True)
    assert "expected one argument" in separate.stderr
    equals = subprocess.run([sys.executable, str(script), "--api-key=-dash"], capture_output=True, text=True)
    assert "expected one argument" not in equals.stderr
    assert "required" in equals.stderr


def test_derive_pack_key_matches_the_desktop_vector():
    from app.content_key import derive_pack_key
    assert derive_pack_key(VECTOR_LICENCE, VECTOR_DEVICE).hex() == WRAP_VECTOR


def test_committed_builder_fixture_opens_with_the_wrap_key():
    import sqlite3
    import tempfile
    from app.content_key import derive_pack_key, open_content_key
    fixture = json.loads((ROOT / "apps" / "desktop" / "src" / "main" / "core" / "search" / "fixtures" / "builder-delta.json").read_text())
    wrap = derive_pack_key(fixture["licence_id"], fixture["device_id_hash"])
    assert wrap.hex() == WRAP_VECTOR
    opened = open_content_key(bytes.fromhex(fixture["sealed_hex"]), wrap)
    assert opened.hex() == CONTENT
    raw = decrypt(bytes.fromhex(fixture["delta_hex"]), opened.hex())
    assert raw[:16] == b"SQLite format 3\x00"
    handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    path = Path(handle.name)
    handle.close()
    try:
        path.write_bytes(raw)
        db = sqlite3.connect(path)
        text = db.execute("SELECT text FROM chunks").fetchone()[0]
        db.close()
    finally:
        path.unlink(missing_ok=True)
    assert text == fixture["chunk_text"] == "Pier 4"


def test_updates_seal_the_builder_key_for_the_activated_device(tmp_path, monkeypatch):
    import sqlite3
    import tempfile
    from app.content_key import derive_pack_key, open_content_key
    from app.licences import stripe_header
    monkeypatch.setenv("PACK_ROOT", str(tmp_path))
    monkeypatch.setenv("PACK_BACKEND", "file")
    monkeypatch.setenv("PACK_CONTENT_KEY_HEX", CONTENT)
    monkeypatch.setenv("LICENCE_SIGNING_KEY_HEX", SIGNING)
    monkeypatch.setenv("LICENCE_KEY_ID", "lic-test")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test")
    monkeypatch.setenv("MAIL_MODE", "console")
    items = parse_rss(RSS)
    plaintext = build_sqlite(items, fixture_embed)
    out = tmp_path / "news-delta" / "2026.10.16"
    write_pack(out, "news-delta", "News delta", "general", "2026.10.16", None, plaintext, CONTENT, SIGNING, "k-test", True)
    device = "ee" * 32
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        email = "seal@example.com"
        event = {
            "id": "evt_seal",
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_seal", "customer_email": email, "payment_status": "paid", "metadata": {"plan": "pro", "term_months": 1}}},
        }
        body = json.dumps(event).encode()
        granted = client.post("/v1/billing/stripe", content=body, headers={"stripe-signature": stripe_header("whsec_test", body), "content-type": "application/json"})
        assert granted.status_code == 200, granted.text
        key = granted.json()["dev_key"]
        started = client.post("/v1/auth/otp/start", json={"email": email})
        token = client.post("/v1/auth/otp/verify", json={
            "email": email,
            "code": started.json()["dev_code"],
            "device": {"device_uid": "seal-box", "name": "Seal", "os": "linux"},
        }).json()["access_token"]
        headers = {"authorization": f"Bearer {token}"}
        activated = client.post("/v1/licences/activate", headers=headers, json={"key": key, "device_id_hash": device, "os": "linux", "name": "Seal"})
        assert activated.status_code == 200, activated.text
        licence_id = activated.json()["licence"]["payload"]["licence_id"]
        listed = client.get("/v1/packs/updates", params={"installed": "", "device_id_hash": device}, headers=headers)
        assert listed.status_code == 200, listed.text
        sealed = listed.json()["content_key_sealed"]
        assert isinstance(sealed, str) and sealed
        assert CONTENT not in listed.text
        opened = open_content_key(bytes.fromhex(sealed), derive_pack_key(licence_id, device))
        assert opened.hex() == CONTENT
        raw = decrypt((out / "delta.sqlite.enc").read_bytes(), opened.hex())
        assert raw[:16] == b"SQLite format 3\x00"
        handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        path = Path(handle.name)
        handle.close()
        try:
            path.write_bytes(raw)
            db = sqlite3.connect(path)
            text = db.execute("SELECT text FROM chunks").fetchone()[0]
            db.close()
        finally:
            path.unlink(missing_ok=True)
        assert text == "Pier 4"
        other = client.get("/v1/packs/updates", params={"device_id_hash": "aa" * 32}, headers=headers)
        assert other.json()["content_key_sealed"] is None
        off = client.post("/v1/licences/deactivate", json={"licence_id": licence_id, "device_id_hash": device})
        assert off.status_code == 200, off.text
        gone = client.get("/v1/packs/updates", params={"device_id_hash": device}, headers=headers)
        assert gone.json()["content_key_sealed"] is None
    monkeypatch.delenv("PACK_CONTENT_KEY_HEX", raising=False)
    with TestClient(app) as client:
        started = client.post("/v1/auth/otp/start", json={"email": "noseal@example.com"})
        token = client.post("/v1/auth/otp/verify", json={
            "email": "noseal@example.com",
            "code": started.json()["dev_code"],
            "device": {"device_uid": "noseal", "name": "No", "os": "linux"},
        }).json()["access_token"]
        listed = client.get("/v1/packs/updates", params={"device_id_hash": device}, headers={"authorization": f"Bearer {token}"})
        assert listed.json()["content_key_sealed"] is None
