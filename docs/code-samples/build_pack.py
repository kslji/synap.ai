"""
Step 3: turn cleaned documents into a signed, versioned *pack*:
    pack.sqlite  (documents + chunks + FTS5 keyword index + sqlite-vec vector index)
    manifest.json (+ manifest.sig = Ed25519 signature over the exact manifest bytes)

The desktop app opens pack.sqlite READ-ONLY. The embedding model here MUST be the same
GGUF the desktop uses for queries (recorded in manifest.embedding) or the app refuses the pack.

pip install sqlite-vec httpx pynacl orjson
Embeddings: EmbeddingGemma 2, 256-d, with the document prefix "title: {title} | text: {chunk}" -
see embedding_spec.py. Default backend = llama.cpp's server with the SAME GGUF the desktop uses:
    llama-server -m embeddinggemma-2-Q8_0.gguf --embeddings --pooling mean -c 2048 -b 2048 -ub 2048 --port 8081
"""
from __future__ import annotations

import gzip
import hashlib
import json
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import sqlite_vec

from embedding_spec import SPEC, LlamaEmbedder

EMBED_URL = "http://127.0.0.1:8081/v1/embeddings"
# ~200-300 words: small enough that 3-5 chunks fit the desktop token budget (EmbeddingGemma 2 itself
# accepts 8,192 tokens, so the limit here is the CHAT model's budget, not the embedder).
CHUNK_TOKENS, OVERLAP_TOKENS = 350, 50


# ---------------- chunking (shared logic with the desktop doc-worker) ----------------
def approx_tokens(s: str) -> int:
    return max(1, int(len(s.split()) * 1.3))   # cheap estimate; good enough for sizing


def chunk_text(text: str, target: int = CHUNK_TOKENS, overlap: int = OVERLAP_TOKENS) -> list[str]:
    """Paragraph-aware greedy packing with a word-level overlap between chunks."""
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
    chunks, cur = [], []
    for p in paras:
        words = p.split()
        while words:                                   # split giant paragraphs
            room = target - approx_tokens(" ".join(cur)) if cur else target
            take = max(1, int(room / 1.3))
            piece, words = words[:take], words[take:]
            cur.extend(piece)
            if approx_tokens(" ".join(cur)) >= target:
                chunks.append(" ".join(cur))
                cur = cur[-int(overlap / 1.3):]        # carry overlap forward
    if cur and (not chunks or approx_tokens(" ".join(cur)) > overlap):
        chunks.append(" ".join(cur))
    return chunks


# ---------------- embeddings ----------------
def embed_docs(docs: list[tuple[str | None, str]], embedder, fake: bool = False) -> list[list[float]]:
    """docs = [(title, chunk_text)]. Prefix + 256-d truncation + re-normalisation happen in the embedder."""
    if fake:   # deterministic stand-in for tests without a running llama-server
        out = []
        for t, x in docs:
            h = hashlib.sha256(f"{t}|{x}".encode()).digest() * 8
            v = [(b - 127.5) / 127.5 for b in h[:SPEC.dim]]
            n = sum(y * y for y in v) ** 0.5
            out.append([y / n for y in v])
        return out
    return embedder.embed_docs(docs)


# ---------------- pack schema ----------------
SCHEMA = f"""
PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 4096;
CREATE TABLE pack_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY, doc_uid TEXT NOT NULL UNIQUE, url TEXT, title TEXT, domain TEXT,
  niche TEXT NOT NULL, lang TEXT, license TEXT, published_at TEXT, fetched_at TEXT, version INTEGER NOT NULL);
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY, chunk_uid TEXT NOT NULL UNIQUE, doc_id INTEGER NOT NULL REFERENCES documents(id),
  ord INTEGER NOT NULL, heading TEXT, text TEXT NOT NULL, token_count INTEGER NOT NULL);
CREATE INDEX idx_chunks_doc ON chunks(doc_id, ord);
CREATE VIRTUAL TABLE chunks_fts USING fts5(heading, text, content='chunks', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE chunk_vec USING vec0(chunk_id INTEGER PRIMARY KEY,
  embedding float[{SPEC.dim}] distance_metric=cosine);
"""


def build_pack(input_glob: str, out_dir: Path, pack_id: str, niche: str, version: str,
               fake_embed: bool = False, batch: int = 64) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    db_path = out_dir / "pack.sqlite"
    db_path.unlink(missing_ok=True)
    db = sqlite3.connect(db_path)
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    db.executescript(SCHEMA)

    embedder = None if fake_embed else LlamaEmbedder(EMBED_URL)
    pending: list[tuple[int, str | None, str]] = []
    n_docs = n_chunks = 0

    def flush():
        nonlocal pending
        if not pending:
            return
        vecs = embed_docs([(t, x) for _, t, x in pending], embedder, fake_embed)
        db.executemany("INSERT INTO chunk_vec(chunk_id, embedding) VALUES (?, ?)",
                       [(cid, sqlite_vec.serialize_float32(v)) for (cid, _, _), v in zip(pending, vecs)])
        pending = []

    for path in sorted(Path().glob(input_glob)):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                md = d.get("metadata", {})
                url = md.get("url", "")
                text = d["text"]
                doc_uid = hashlib.sha256(f"{url}\n{text}".encode()).hexdigest()[:32]
                title = md.get("title") or text.split("\n", 1)[0][:200]
                cur = db.execute(
                    "INSERT OR IGNORE INTO documents(doc_uid,url,title,domain,niche,lang,license,"
                    "published_at,fetched_at,version) VALUES (?,?,?,?,?,?,?,?,?,1)",
                    (doc_uid, url, title, md.get("domain"),
                     niche, md.get("language", "en"), md.get("license"), md.get("published_at"),
                     md.get("date")))
                if cur.rowcount == 0:
                    continue
                doc_id = cur.lastrowid
                n_docs += 1
                for i, ch in enumerate(chunk_text(text)):
                    chunk_uid = hashlib.sha256(f"{doc_uid}:{i}:{ch}".encode()).hexdigest()[:32]
                    c = db.execute("INSERT INTO chunks(chunk_uid,doc_id,ord,heading,text,token_count) "
                                   "VALUES (?,?,?,?,?,?)", (chunk_uid, doc_id, i, None, ch, approx_tokens(ch)))
                    pending.append((c.lastrowid, title, ch))  # embedded as "title: {title} | text: {chunk}"
                    n_chunks += 1
                    if len(pending) >= batch:
                        flush()
    flush()
    db.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")   # build keyword index
    meta = {"pack_id": pack_id, "niche": niche, "version": version, "schema_version": "1",
            "embedding_model": SPEC.id, "embedding_dim": str(SPEC.dim),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    db.executemany("INSERT INTO pack_meta VALUES (?,?)", meta.items())
    db.commit()
    db.execute("VACUUM")          # compact + deterministic-ish page layout
    db.close()
    print(f"{pack_id}@{version}: {n_docs} docs, {n_chunks} chunks -> {db_path}")
    return db_path


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def write_and_sign_manifest(out_dir: Path, pack_id: str, niche: str, version: str,
                            signing_key_hex: str, key_id: str, base_url: str,
                            min_app_version: str = "0.1.0", previous: str | None = None) -> dict:
    """manifest.json lists every file with size + sha256; manifest.sig signs the exact bytes."""
    from nacl.signing import SigningKey
    db = out_dir / "pack.sqlite"
    manifest = {
        "format": "harbor-pack/1",
        "pack_id": pack_id, "niche": niche, "version": version, "previous_version": previous,
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "min_app_version": min_app_version,
        "embedding": SPEC.manifest(),     # app refuses the pack unless this matches its own spec
        "chunking": {"target_tokens": CHUNK_TOKENS, "overlap_tokens": OVERLAP_TOKENS},
        "files": [{"name": "pack.sqlite", "role": "index", "size": db.stat().st_size,
                   "sha256": sha256_file(db), "url": f"{base_url}/{pack_id}/{version}/pack.sqlite.zst",
                   "compression": "zstd"}],
        "deltas": [],     # filled when a zstd --patch-from delta vs `previous` is published
        "license_notes": "Wikipedia text CC BY-SA 4.0; see sources table for per-document licenses",
        "signing_key_id": key_id,
    }
    body = json.dumps(manifest, indent=2, sort_keys=True).encode()
    (out_dir / "manifest.json").write_bytes(body)
    sig = SigningKey(bytes.fromhex(signing_key_hex)).sign(body).signature
    (out_dir / "manifest.sig").write_bytes(sig)          # 64 raw bytes (Ed25519)
    return manifest


def verify(out_dir: Path, verify_key_hex: str) -> bool:
    """What the desktop does (TypeScript main process, see ts/pack-verify.ts): signature first, then file hashes."""
    from nacl.signing import VerifyKey
    body = (out_dir / "manifest.json").read_bytes()
    VerifyKey(bytes.fromhex(verify_key_hex)).verify(body, (out_dir / "manifest.sig").read_bytes())
    m = json.loads(body)
    return all(sha256_file(out_dir / f["name"]) == f["sha256"] for f in m["files"])


if __name__ == "__main__":
    import sys
    from nacl.signing import SigningKey
    t0 = time.time()
    out = Path("dist/packs/marine-core/2026.10.08")
    build_pack(sys.argv[1] if len(sys.argv) > 1 else "data/marine/*/deduped/*.jsonl.gz", out,
               "marine-core", "marine", "2026.10.08", fake_embed="--fake-embed" in sys.argv)
    import os
    # In production the key comes from a CI secret (never committed). For local tests we generate one
    # and write the PUBLIC key next to the pack so ts/tests can verify it.
    key_hex = os.environ.get("PACK_SIGNING_KEY_HEX")
    sk = SigningKey(bytes.fromhex(key_hex)) if key_hex else SigningKey.generate()
    (out / "signing_pub.hex").write_text(sk.verify_key.encode().hex())
    write_and_sign_manifest(out, "marine-core", "marine", "2026.10.08", sk.encode().hex(),
                            "k2026a", "https://packs.example.com")
    print("verified:", verify(out, sk.verify_key.encode().hex()), f"({time.time()-t0:.1f}s)")
