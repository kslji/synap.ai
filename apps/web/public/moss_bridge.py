#!/usr/bin/env python3
"""Pack-local Moss bridge (127.0.0.1:18767).

- Credentials live only in moss_vault.enc (sealed). Never printed.
- Online + valid keys → Moss SDK when the moss package is available.
- Offline or missing keys → keyword index on this device (still local).
- Browser must not call this bridge when navigator.onLine is false.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
VAULT = HERE / "moss_vault.enc"
DOCS_PATH = HERE / "moss_local.json"
PORT = 18767

# Must match apps/web/scripts/seal-moss-vault.mjs SEAL_PARTS
_SEAL_PARTS = ["surf", "moss", "v1", "pack", "vault", "k7m2p9qx"]

_docs: list[dict] = []
_client = None
_backend = "keyword-fallback"
_lock = threading.Lock()


def _seal_key() -> bytes:
    return hashlib.sha256("|".join(_SEAL_PARTS).encode("utf-8")).digest()


def _xor(data: bytes, key: bytes) -> bytes:
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def unseal_vault(path: Path) -> tuple[str, str]:
    if not path.is_file():
        return "", ""
    try:
        blob = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return "", ""
    if not isinstance(blob, dict) or blob.get("alg") != "surf-seal-v1":
        return "", ""
    try:
        key = _seal_key()
        nonce = __import__("base64").b64decode(blob["nonce"])
        ct = __import__("base64").b64decode(blob["ct"])
        mac = blob.get("mac") or ""
        expect = hmac.new(key, nonce + ct, hashlib.sha256).digest()
        got = __import__("base64").b64decode(mac)
        if not hmac.compare_digest(expect, got):
            return "", ""
        stream = hashlib.sha256(key + nonce).digest()
        plain = _xor(ct, stream)
        data = json.loads(plain.decode("utf-8"))
        return str(data.get("project_id") or "").strip(), str(data.get("project_key") or "").strip()
    except Exception:
        return "", ""


def _load_docs() -> None:
    global _docs
    if DOCS_PATH.is_file():
        try:
            raw = json.loads(DOCS_PATH.read_text(encoding="utf-8"))
            _docs = [d for d in raw if isinstance(d, dict) and d.get("text")]
        except Exception:
            _docs = []
    else:
        _docs = []


def _save_docs() -> None:
    try:
        DOCS_PATH.write_text(json.dumps(_docs, indent=2), encoding="utf-8")
    except OSError:
        pass


def _bind_sdk(pid: str, key: str) -> None:
    global _client, _backend
    if not pid or not key:
        _client = None
        _backend = "keyword-fallback"
        return
    try:
        from moss import MossClient  # type: ignore

        _client = MossClient(pid, key)
        _backend = "moss"
    except Exception:
        _client = None
        _backend = "keyword-fallback"


def add_doc(doc_id: str, text: str) -> None:
    global _docs
    text = (text or "").strip()
    if not text:
        return
    doc_id = (doc_id or f"doc-{int(time.time())}")[:80]
    with _lock:
        _docs = [d for d in _docs if d.get("id") != doc_id]
        _docs.append({"id": doc_id, "text": text[:16000]})
        _docs = _docs[-200:]
        _save_docs()


def _keyword(q: str, top_k: int = 4) -> dict:
    t0 = time.perf_counter()
    words = {w for w in re.findall(r"[a-z0-9]+", q.lower()) if len(w) > 2}
    scored = []
    with _lock:
        corpus = list(_docs)
    for d in corpus:
        bag = set(re.findall(r"[a-z0-9]+", str(d.get("text") or "").lower()))
        if not words or not bag:
            continue
        overlap = len(words & bag)
        if overlap:
            scored.append({**d, "score": round(overlap / math.sqrt(len(bag)), 4)})
    scored.sort(key=lambda x: x["score"], reverse=True)
    return {
        "backend": "moss-local-session-fallback",
        "time_taken_ms": round((time.perf_counter() - t0) * 1000, 3),
        "docs": scored[:top_k],
        "hits": len(scored[:top_k]),
    }


def query(q: str, local_only: bool = False) -> dict:
    global _backend
    t0 = time.perf_counter()
    if not local_only and _client is not None:
        try:
            # Best-effort SDK path; any failure falls back to keyword.
            import asyncio

            async def _run():
                session = await _client.session("surf-pack-vault")
                cache = HERE / "moss_session"
                cache.mkdir(parents=True, exist_ok=True)
                try:
                    await session.load_from_disk(str(cache))
                except Exception:
                    pass
                with _lock:
                    corpus = list(_docs)
                if corpus:
                    await session.add_docs([{"id": d["id"], "text": d["text"]} for d in corpus])
                raw = await session.query(q)
                try:
                    await session.save_to_disk(str(cache))
                except Exception:
                    pass
                docs = []
                for d in getattr(raw, "docs", []) or []:
                    docs.append(
                        {
                            "id": getattr(d, "id", None),
                            "text": getattr(d, "text", str(d)),
                            "score": getattr(d, "score", None),
                        }
                    )
                if not docs and isinstance(raw, dict):
                    docs = raw.get("docs") or []
                return {
                    "backend": "moss",
                    "time_taken_ms": round((time.perf_counter() - t0) * 1000, 3),
                    "docs": docs[:4],
                    "hits": len(docs[:4]),
                }

            return asyncio.run(_run())
        except Exception:
            _backend = "keyword-fallback"
    return _keyword(q)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quiet — never log bodies/keys
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/health", "/v1/health"):
            self._json(
                200,
                {
                    "ok": True,
                    "moss": {
                        "enabled": True,
                        "backend": _backend,
                        "docs": len(_docs),
                        "sdk": _backend == "moss",
                    },
                },
            )
            return
        if path == "/v1/memory/search":
            qs = parse_qs(urlparse(self.path).query)
            q = (qs.get("q") or [""])[0]
            local_only = (qs.get("local_only") or ["0"])[0] in ("1", "true", "True")
            self._json(200, query(q, local_only=local_only))
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            data = {}
        if path in ("/v1/memory", "/v1/memory/"):
            add_doc(str(data.get("id") or ""), str(data.get("text") or ""))
            self._json(200, {"ok": True, "docs": len(_docs), "backend": _backend})
            return
        self._json(404, {"error": "not found"})


def main() -> int:
    pid, key = unseal_vault(VAULT)
    _load_docs()
    _bind_sdk(pid, key)
    # Never print pid/key
    print(f"Surf Moss bridge on 127.0.0.1:{PORT} backend={_backend} docs={len(_docs)}", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
