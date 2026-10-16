"""Build a signed, encrypted knowledge-pack delta.

Run by us, not by the desktop user. Embeddings are 256-d. The real path calls
llama-server (EmbeddingGemma, same template as build_pack.py). Tests pass
--fixture-embed, which is a deterministic hash vector and is not EmbeddingGemma.

Keys come from the environment or flags. Nothing in this file is a real key.

  PACK_SIGNING_KEY_HEX   32-byte ed25519 seed, 64 hex chars
  PACK_CONTENT_KEY_HEX   32-byte NaCl secretbox key, 64 hex chars

The output directory is a surf-pack the catalog can serve:
  manifest.json, manifest.sig, delta.sqlite.enc
The encrypted file is the sqlite delta (new documents, chunks, 256-d blobs).
Chat still opens plaintext pack.sqlite when that file is present. A normal
install opens delta.sqlite.enc after the pack server seals PACK_CONTENT_KEY_HEX
for the activated licence and device. The app unwraps that seal with the
licence-derived key. This script does not put the content key in the app.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1] / "api"
HARNESS_ROOT = Path(__file__).resolve().parents[2] / "harness"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))
if str(HARNESS_ROOT) not in sys.path:
    sys.path.insert(0, str(HARNESS_ROOT))
from core.pack_gate import assert_can_sign  # noqa: E402

SPEC = {
    "id": "embeddinggemma-2-text@256",
    "model": "google/embeddinggemma-2",
    "file": "embeddinggemma-2-Q8_0.gguf",
    "native_dim": 768,
    "dim": 256,
    "pooling": "mean",
    "normalize": True,
    "query_prefix": "task: search result | query: ",
    "doc_template": "title: {title} | text: {text}",
}

SCHEMA = """
CREATE TABLE delta_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  doc_uid TEXT NOT NULL UNIQUE,
  url TEXT,
  title TEXT NOT NULL,
  published_at TEXT
);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  chunk_uid TEXT NOT NULL UNIQUE,
  doc_id INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE TABLE embeddings (
  chunk_id INTEGER PRIMARY KEY,
  dim INTEGER NOT NULL,
  embedding BLOB NOT NULL
);
"""


def fixture_embed(title: str, text: str) -> list[float]:
    """Deterministic 256-d vector for tests. Not an EmbeddingGemma vector."""
    digest = hashlib.sha256(f"{title}\n{text}".encode()).digest()
    raw = list(digest) * 8
    vals = [(byte / 255.0) - 0.5 for byte in raw[:256]]
    norm = sum(item * item for item in vals) ** 0.5 or 1.0
    return [item / norm for item in vals]


def embed_remote(title: str, text: str, url: str, api_key: str) -> list[float]:
    import httpx

    body = SPEC["doc_template"].replace("{title}", title).replace("{text}", text.strip())
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    response = httpx.post(url, json={"input": [body], "encoding_format": "float"}, headers=headers, timeout=120)
    response.raise_for_status()
    vector = response.json()["data"][0]["embedding"]
    if len(vector) < SPEC["native_dim"]:
        raise RuntimeError(f"embedding dim {len(vector)}")
    head = vector[: SPEC["dim"]]
    norm = sum(item * item for item in head) ** 0.5
    if norm == 0:
        raise RuntimeError("zero embedding")
    return [item / norm for item in head]


def local_tag(element: ET.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def text_of(parent: ET.Element, name: str) -> str:
    for child in parent:
        if local_tag(child) == name and child.text:
            return " ".join(child.text.split())
    return ""


def parse_sitemap(xml: str) -> list[dict]:
    root = ET.fromstring(xml)
    rows = []
    for node in root.iter():
        if local_tag(node) != "url":
            continue
        loc = text_of(node, "loc")
        if not loc:
            continue
        rows.append({"url": loc, "title": loc.rsplit("/", 1)[-1] or loc, "text": loc, "published": text_of(node, "lastmod") or None})
    return rows


def parse_rss(xml: str) -> list[dict]:
    root = ET.fromstring(xml)
    rows = []
    for node in root.iter():
        if local_tag(node) != "item":
            continue
        title = text_of(node, "title")
        link = text_of(node, "link")
        description = text_of(node, "description")
        if title and link:
            rows.append({"url": link, "title": title, "text": description or title, "published": text_of(node, "pubDate") or None})
    return rows


def parse_arxiv(xml: str) -> list[dict]:
    root = ET.fromstring(xml)
    rows = []
    for node in root.iter():
        if local_tag(node) != "entry":
            continue
        title = text_of(node, "title")
        link = text_of(node, "id")
        summary = text_of(node, "summary")
        if title and link:
            rows.append({"url": link, "title": title, "text": summary or title, "published": text_of(node, "published") or None})
    return rows


def parse_hf(payload: list | dict) -> list[dict]:
    rows = payload if isinstance(payload, list) else payload.get("models", [])
    out = []
    for item in rows:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        model_id = str(item["id"])
        out.append({
            "url": f"https://huggingface.co/{model_id}",
            "title": model_id,
            "text": str(item.get("pipeline_tag") or model_id),
            "published": item.get("lastModified"),
        })
    return out


def parse_feed(kind: str, body: str) -> list[dict]:
    if kind == "sitemap":
        return parse_sitemap(body)
    if kind == "rss":
        return parse_rss(body)
    if kind == "arxiv":
        return parse_arxiv(body)
    if kind == "huggingface":
        return parse_hf(json.loads(body))
    raise ValueError(f"unknown feed {kind}")


def pack_floats(values: list[float]) -> bytes:
    import struct
    return struct.pack(f"<{len(values)}f", *values)


def encrypt(data: bytes, key_hex: str) -> bytes:
    from nacl.secret import SecretBox
    key = bytes.fromhex(key_hex)
    if len(key) != 32:
        raise SystemExit("PACK_CONTENT_KEY_HEX must be 32 bytes")
    box = SecretBox(key)
    return bytes(box.encrypt(data))


def decrypt(blob: bytes, key_hex: str) -> bytes:
    from nacl.secret import SecretBox
    return SecretBox(bytes.fromhex(key_hex)).decrypt(blob)


def build_sqlite(items: list[dict], embed) -> bytes:
    import tempfile
    handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    path = Path(handle.name)
    handle.close()
    try:
        db = sqlite3.connect(path)
        db.executescript(SCHEMA)
        for item in items:
            text = " ".join(str(item.get("text") or "").split())
            title = " ".join(str(item.get("title") or "").split()) or "Untitled"
            if not text:
                continue
            doc_uid = hashlib.sha256(text.encode()).hexdigest()[:32]
            db.execute(
                "INSERT OR IGNORE INTO documents(doc_uid, url, title, published_at) VALUES (?,?,?,?)",
                (doc_uid, item.get("url"), title, item.get("published")),
            )
            doc_id = db.execute("SELECT id FROM documents WHERE doc_uid = ?", (doc_uid,)).fetchone()[0]
            chunk_uid = doc_uid + ":0"
            db.execute(
                "INSERT OR IGNORE INTO chunks(chunk_uid, doc_id, text) VALUES (?,?,?)",
                (chunk_uid, doc_id, text),
            )
            chunk_id = db.execute("SELECT id FROM chunks WHERE chunk_uid = ?", (chunk_uid,)).fetchone()[0]
            vector = embed(title, text)
            if len(vector) != 256:
                raise RuntimeError(f"embedding dim {len(vector)}")
            db.execute(
                "INSERT OR REPLACE INTO embeddings(chunk_id, dim, embedding) VALUES (?,?,?)",
                (chunk_id, 256, pack_floats(vector)),
            )
        if db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0:
            raise SystemExit("no usable text")
        db.execute("INSERT INTO delta_meta VALUES (?,?)", ("embedding_dim", "256"))
        db.commit()
        db.close()
        return path.read_bytes()
    finally:
        path.unlink(missing_ok=True)


def write_pack(out: Path, pack_id: str, title: str, niche: str, version: str, previous: str | None, plaintext: bytes, content_key: str, signing_key: str, key_id: str, fixture: bool) -> None:
    from nacl.signing import SigningKey
    out.mkdir(parents=True, exist_ok=True)
    encrypted = encrypt(plaintext, content_key)
    (out / "delta.sqlite.enc").write_bytes(encrypted)
    digest = hashlib.sha256(encrypted).hexdigest()
    manifest = {
        "format": "surf-pack/1",
        "pack_id": pack_id,
        "title": title,
        "niche": niche,
        "version": version,
        "previous_version": previous,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_app_version": "0.1.0",
        "embedding": {
            "id": SPEC["id"], "model": SPEC["model"], "file": SPEC["file"],
            "native_dim": SPEC["native_dim"], "dim": SPEC["dim"], "pooling": SPEC["pooling"],
            "normalize": SPEC["normalize"], "query_prefix": SPEC["query_prefix"], "doc_template": SPEC["doc_template"],
        },
        "chunking": {"target_tokens": 250, "overlap_tokens": 40},
        "files": [{
            "name": "delta.sqlite.enc",
            "role": "index",
            "size": len(encrypted),
            "sha256": digest,
            "url": "https://packs.invalid/delta.sqlite.enc",
            "compression": "none",
        }],
        "signing_key_id": key_id,
        "delta": {"name": "delta.sqlite.enc", "cipher": "nacl-secretbox", "fixture_embed": fixture},
    }
    body = json.dumps(manifest, indent=2, sort_keys=True).encode()
    (out / "manifest.json").write_bytes(body)
    (out / "manifest.sig").write_bytes(SigningKey(bytes.fromhex(signing_key)).sign(body).signature)


def verify_delta(folder: Path, public_hex: str, content_key: str) -> dict:
    from nacl.signing import VerifyKey
    body = (folder / "manifest.json").read_bytes()
    sig = (folder / "manifest.sig").read_bytes()
    VerifyKey(bytes.fromhex(public_hex)).verify(body, sig)
    manifest = json.loads(body)
    blob = (folder / "delta.sqlite.enc").read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    listed = next(item["sha256"] for item in manifest["files"] if item["name"] == "delta.sqlite.enc")
    if listed != digest:
        raise RuntimeError("delta hash mismatch")
    raw = decrypt(blob, content_key)
    import tempfile
    handle = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
    path = Path(handle.name)
    handle.close()
    try:
        path.write_bytes(raw)
        db = sqlite3.connect(path)
        count = db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0]
        dim, emb = db.execute("SELECT dim, embedding FROM embeddings LIMIT 1").fetchone()
        db.close()
    finally:
        path.unlink(missing_ok=True)
    return {"chunks": count, "dim": dim, "embedding_bytes": len(emb), "fixture_embed": manifest.get("delta", {}).get("fixture_embed")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--id", default="news-delta")
    parser.add_argument("--title", default="News delta")
    parser.add_argument("--niche", default="general")
    parser.add_argument("--version", default="2026.10.16")
    parser.add_argument("--previous", default="")
    parser.add_argument("--feed", action="append", default=[], help="kind=path, kind is sitemap, rss, arxiv, or huggingface")
    parser.add_argument("--fixture-embed", action="store_true")
    parser.add_argument("--embed-url", default=os.environ.get("EMBED_URL", "http://127.0.0.1:8081/v1/embeddings"))
    parser.add_argument("--api-key", default=os.environ.get("EMBED_API_KEY", ""))
    parser.add_argument("--key-hex", default=os.environ.get("PACK_SIGNING_KEY_HEX", ""))
    parser.add_argument("--content-key-hex", default=os.environ.get("PACK_CONTENT_KEY_HEX", ""))
    parser.add_argument("--key-id", default=os.environ.get("PACK_SIGNING_KEY_ID", "k2026a"))
    args = parser.parse_args()
    assert_can_sign(args.niche)
    if len(args.key_hex) != 64 or len(args.content_key_hex) != 64:
        raise SystemExit("PACK_SIGNING_KEY_HEX and PACK_CONTENT_KEY_HEX must be 64 hex chars and must not live in the repo.")
    items: list[dict] = []
    for spec in args.feed:
        kind, path = spec.split("=", 1)
        items.extend(parse_feed(kind, Path(path).read_text(encoding="utf-8")))
    if not items:
        raise SystemExit("pass --feed kind=file at least once")
    if args.fixture_embed:
        print("fixture embeddings are a hash vector, not EmbeddingGemma", file=sys.stderr)
        embed = fixture_embed
    else:
        embed = lambda title, text: embed_remote(title, text, args.embed_url, args.api_key)  # noqa: E731
    plaintext = build_sqlite(items, embed)
    write_pack(args.out, args.id, args.title, args.niche, args.version, args.previous or None, plaintext, args.content_key_hex, args.key_hex, args.key_id, args.fixture_embed)
    print(f"signed encrypted delta {args.id}@{args.version} -> {args.out}")


if __name__ == "__main__":
    main()
