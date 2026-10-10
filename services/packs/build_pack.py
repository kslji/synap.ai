"""Build and sign a knowledge pack from a folder of text files.

Embeddings come from llama-server running the same EmbeddingGemma 2 GGUF the
desktop uses. The signing seed is PACK_SIGNING_KEY_HEX or --key-hex. Never
commit that seed.

Example:
  python3 services/packs/build_pack.py \\
    --src services/packs/general-starter --out /tmp/general-starter \\
    --embed-url http://127.0.0.1:8081/v1/embeddings
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
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
CREATE TABLE pack_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY, doc_uid TEXT NOT NULL UNIQUE, url TEXT, title TEXT, domain TEXT,
  niche TEXT NOT NULL, lang TEXT, license TEXT, published_at TEXT, fetched_at TEXT, version INTEGER NOT NULL);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY, chunk_uid TEXT NOT NULL UNIQUE, doc_id INTEGER NOT NULL REFERENCES documents(id),
  ord INTEGER NOT NULL, heading TEXT, text TEXT NOT NULL, token_count INTEGER NOT NULL);
CREATE VIRTUAL TABLE chunks_fts USING fts5(heading, text, content='chunks', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE chunk_vec USING vec0(chunk_id INTEGER PRIMARY KEY, embedding float[256] distance_metric=cosine);
"""


def truncate_normalize(values: list[float], dim: int) -> list[float]:
    head = values[:dim]
    norm = sum(item * item for item in head) ** 0.5
    if norm == 0:
        raise RuntimeError("zero embedding")
    return [item / norm for item in head]


def embed_doc(title: str, text: str, url: str, api_key: str) -> list[float]:
    import httpx

    body = SPEC["doc_template"].replace("{title}", title).replace("{text}", text.strip())
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    response = httpx.post(url, json={"input": [body], "encoding_format": "float"}, headers=headers, timeout=120)
    response.raise_for_status()
    vector = response.json()["data"][0]["embedding"]
    if len(vector) < SPEC["native_dim"]:
        raise RuntimeError(f"embedding dim {len(vector)}")
    return truncate_normalize(vector, SPEC["dim"])


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def build(src: Path, out: Path, pack_id: str, title: str, niche: str, version: str, embed_url: str, api_key: str, key_hex: str, key_id: str) -> None:
    import sqlite_vec
    from app.injection import filter_paragraphs
    from nacl.signing import SigningKey

    out.mkdir(parents=True, exist_ok=True)
    db_path = out / "pack.sqlite"
    if db_path.exists():
        db_path.unlink()
    db = sqlite3.connect(db_path)
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    db.executescript(SCHEMA)
    files = sorted(path for path in src.iterdir() if path.suffix.lower() in {".txt", ".md"})
    if not files:
        raise SystemExit(f"no text files in {src}")
    for path in files:
        text, _injection, ignored = filter_paragraphs(path.read_text(encoding="utf-8"))
        text = text.strip()
        if ignored:
            print(f"injection ignored flags={','.join(flag for item in ignored for flag in item['flags'])}", file=sys.stderr)
        if not text:
            continue
        source_title = " ".join(part.capitalize() for part in path.stem.replace("_", "-").split("-")) or title
        doc_uid = hashlib.sha256(text.encode()).hexdigest()[:32]
        db.execute(
            "INSERT INTO documents(doc_uid,url,title,domain,niche,lang,license,published_at,fetched_at,version) VALUES (?,?,?,?,?,?,?,?,?,1)",
            (doc_uid, f"pack://{pack_id}/{path.name}", source_title, "local", niche, "en", "demo", version, version),
        )
        doc_id = db.execute("SELECT id FROM documents WHERE doc_uid = ?", (doc_uid,)).fetchone()[0]
        db.execute(
            "INSERT INTO chunks(chunk_uid,doc_id,ord,heading,text,token_count) VALUES (?,?,?,?,?,?)",
            (doc_uid + ":0", doc_id, 0, title, text, len(text.split())),
        )
        chunk_id = db.execute("SELECT id FROM chunks WHERE chunk_uid = ?", (doc_uid + ":0",)).fetchone()[0]
        vector = embed_doc(title, text, embed_url, api_key)
        db.execute(
            "INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)",
            (chunk_id, sqlite_vec.serialize_float32(vector)),
        )
    if db.execute("SELECT COUNT(*) FROM chunks").fetchone()[0] == 0:
        raise SystemExit("no usable text after the injection filter")
    db.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
    db.executemany("INSERT INTO pack_meta VALUES (?,?)", {
        "pack_id": pack_id, "version": version, "embedding_model": SPEC["id"],
    }.items())
    db.commit()
    db.close()
    manifest = {
        "format": "surf-pack/1",
        "pack_id": pack_id,
        "title": title,
        "niche": niche,
        "version": version,
        "previous_version": None,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_app_version": "0.1.0",
        "embedding": {
            "id": SPEC["id"], "model": SPEC["model"], "file": SPEC["file"],
            "native_dim": SPEC["native_dim"], "dim": SPEC["dim"], "pooling": SPEC["pooling"],
            "normalize": SPEC["normalize"], "query_prefix": SPEC["query_prefix"], "doc_template": SPEC["doc_template"],
        },
        "chunking": {"target_tokens": 250, "overlap_tokens": 40},
        "files": [{
            "name": "pack.sqlite",
            "role": "index",
            "size": db_path.stat().st_size,
            "sha256": sha256_file(db_path),
            "url": "https://packs.invalid/pack.sqlite",
            "compression": "none",
        }],
        "signing_key_id": key_id,
    }
    body = json.dumps(manifest, indent=2, sort_keys=True).encode()
    (out / "manifest.json").write_bytes(body)
    seed = bytes.fromhex(key_hex)
    (out / "manifest.sig").write_bytes(SigningKey(seed).sign(body).signature)
    print(f"signed {pack_id}@{version} -> {out}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--id", default="general-starter")
    parser.add_argument("--title", default="General starter")
    parser.add_argument("--niche", default="general")
    parser.add_argument("--version", default="2026.10.09")
    parser.add_argument("--embed-url", default=os.environ.get("EMBED_URL", "http://127.0.0.1:8081/v1/embeddings"))
    parser.add_argument("--api-key", default=os.environ.get("EMBED_API_KEY", ""))
    parser.add_argument("--key-hex", default=os.environ.get("PACK_SIGNING_KEY_HEX", ""))
    parser.add_argument("--key-id", default=os.environ.get("PACK_SIGNING_KEY_ID", "k2026a"))
    args = parser.parse_args()
    assert_can_sign(args.niche)
    if len(args.key_hex) != 64:
        raise SystemExit("PACK_SIGNING_KEY_HEX must be a 32-byte ed25519 seed (64 hex chars) and must not live in the repo.")
    build(args.src, args.out, args.id, args.title, args.niche, args.version, args.embed_url, args.api_key, args.key_hex, args.key_id)


if __name__ == "__main__":
    main()
