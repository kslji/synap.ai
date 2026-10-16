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
