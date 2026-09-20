"""On-device Moss retrieval. Indexes are never push_index()'d to Moss Cloud.

Primary: Moss SDK semantic search when project credentials are present.
Secondary: local keyword overlap when creds are missing, exhausted, or Moss errors.
User documents only. Product README / marketing seed notes are never stored or returned.
On shared demo hosts, every doc is tagged with the signed-in user id so accounts never
retrieve each other's files.
"""

from __future__ import annotations

import json
import math
import re
import time

from config import settings
from instances import current_dir
from moss_creds import load_creds

# Copy that used to be seeded into every empty index. Must never be retrieved.
PRODUCT_LEAK = re.compile(
    r"Small Cloud keeps chat on-device|"
    r"static host never receives prompts|"
    r"Default model llama3\.2:3b uses about|"
    r"Voice uses LiveKit local loopback|"
    r"Whisper is not loaded in the UI",
    re.I,
)


def is_product_leak(doc: dict) -> bool:
    doc_id = str(doc.get("id") or "")
    text = str(doc.get("text") or "")
    if doc_id.startswith("seed-"):
        return True
    if PRODUCT_LEAK.search(text):
        return True
    return False


class MossRuntime:
    def __init__(self) -> None:
        self.backend = "keyword-fallback"
        self._client = None
        self._docs: list[dict] = []
        self._load()
        self._bind_sdk()

    def reload(self) -> None:
        self._client = None
        self._docs = []
        self._load()
        self._bind_sdk()

    def _index_path(self):
        root = current_dir()
        return None if root is None else root / "moss_local.json"

    def _load(self) -> None:
        path = self._index_path()
        loaded: list[dict] = []
        if path and path.exists():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                loaded = []
        cleaned = [d for d in loaded if isinstance(d, dict) and d.get("text") and not is_product_leak(d)]
        self._docs = cleaned
        if path and loaded and len(cleaned) != len(loaded):
            self._persist()

    def _persist(self) -> None:
        path = self._index_path()
        if path is None:
            return
        try:
            path.write_text(json.dumps(self._docs, indent=2), encoding="utf-8")
        except OSError:
            return

    def _bind_sdk(self) -> None:
        pid, key = load_creds()
        if not pid or not key:
            self._client = None
            self.backend = "keyword-fallback"
            return
        try:
            from moss import MossClient  # type: ignore

            self._client = MossClient(pid, key)
            self.backend = "moss"
        except Exception:
            self._client = None
            self.backend = "keyword-fallback"

    def configure(self, project_id: str, project_key: str) -> dict:
        from moss_creds import save_creds

        save_creds(project_id, project_key)
        self._bind_sdk()
        return {"backend": self.backend, "docs": self.docs, "sdk": self._client is not None}

    @property
    def enabled(self) -> bool:
        return True

    @property
    def docs(self) -> int:
        return len(self._docs)

    def _owner_of(self, doc: dict) -> str:
        meta = doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {}
        return str(meta.get("owner") or "").strip()

    def _docs_for(self, owner: str | None) -> list[dict]:
        """Per-user slice of the host index. Unowned legacy docs are never shared across users."""
        if not owner:
            return list(self._docs)
        return [d for d in self._docs if self._owner_of(d) == owner]

    def add(self, doc_id: str, text: str, metadata: dict | None = None, owner: str | None = None) -> None:
        meta = dict(metadata or {})
        if owner:
            meta["owner"] = owner
        rec = {"id": doc_id, "text": text, "metadata": meta}
        if is_product_leak(rec):
            return
        # Same doc id can exist for different owners on a shared demo host.
        def same_slot(d: dict) -> bool:
            if d.get("id") != doc_id:
                return False
            if owner:
                return self._owner_of(d) == owner
            return not self._owner_of(d)

        self._docs = [d for d in self._docs if not same_slot(d)] + [rec]
        self._persist()

    def _filter_hits(self, docs: list, owner: str | None = None) -> list[dict]:
        owned_ids = {d["id"] for d in self._docs_for(owner)} if owner else None
        out: list[dict] = []
        for d in docs or []:
            if isinstance(d, dict):
                rec = d
            else:
                rec = {
                    "id": getattr(d, "id", None),
                    "text": getattr(d, "text", str(d)),
                    "score": getattr(d, "score", None),
                }
            if not rec.get("text") or is_product_leak(rec):
                continue
            # SDK may return ids from a shared session — keep only this user's corpus.
            if owned_ids is not None and rec.get("id") not in owned_ids:
                continue
            out.append(rec)
        return out

    async def _query_moss_sdk(self, text: str, top_k: int, t0: float, owner: str | None = None) -> dict | None:
        """Primary path: Moss semantic search. Returns None to trigger secondary fallback."""
        if self._client is None:
            return None
        corpus = self._docs_for(owner)
        if not corpus:
            return {
                "backend": "moss",
                "time_taken_ms": round((time.perf_counter() - t0) * 1000, 3),
                "docs": [],
            }
        try:
            session = await self._client.session(settings.moss_index)
            root = current_dir()
            if root is None:
                return None
            # Per-user session cache so one account never loads another's embeddings from disk.
            cache_name = f"moss_session_{owner}" if owner else "moss_session"
            cache = root / cache_name
            cache.mkdir(parents=True, exist_ok=True)
            try:
                await session.load_from_disk(str(cache))
            except Exception:
                pass
            await session.add_docs([{"id": d["id"], "text": d["text"]} for d in corpus])
            raw = await session.query(text)
            try:
                await session.save_to_disk(str(cache))
            except Exception:
                pass
            ms = (time.perf_counter() - t0) * 1000
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
            self.backend = "moss"
            return {
                "backend": "moss",
                "time_taken_ms": round(ms, 3),
                "docs": self._filter_hits(docs, owner=owner)[:top_k],
            }
        except Exception:
            # Creds exhausted, network/auth failure, or SDK error → caller uses keyword.
            return None

    async def query(
        self, text: str, top_k: int = 4, local_only: bool = False, owner: str | None = None
    ) -> dict:
        t0 = time.perf_counter()
        # Re-read .env / instance creds each query so keys added later take effect.
        if self._client is None:
            self._bind_sdk()

        # Primary: Moss SDK whenever credentials are bound and we are allowed to use them.
        # local_only (browser offline) skips the SDK and uses secondary keyword search.
        if not local_only:
            hit = await self._query_moss_sdk(text, top_k, t0, owner=owner)
            if hit is not None:
                return hit

        # Secondary: local keyword overlap (no Moss / offline / creds failed).
        return self._keyword(text, top_k, t0, owner=owner)

    def _keyword(self, text: str, top_k: int, t0: float, owner: str | None = None) -> dict:
        q = {w for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) > 2}
        scored = []
        for d in self._docs_for(owner):
            if is_product_leak(d):
                continue
            words = set(re.findall(r"[a-z0-9]+", d["text"].lower()))
            if not q or not words:
                continue
            overlap = len(q & words)
            if overlap:
                scored.append({**d, "score": round(overlap / math.sqrt(len(words)), 4)})
        scored.sort(key=lambda x: x["score"], reverse=True)
        docs = self._filter_hits(scored, owner=owner)[:top_k]
        return {
            "backend": "moss-local-session-fallback",
            "time_taken_ms": round((time.perf_counter() - t0) * 1000, 3),
            "docs": docs,
        }

    def clear(self, owner: str | None = None) -> dict:
        """Drop Moss/keyword docs. With owner, only that user's slice (shared demo host)."""
        if owner:
            self._docs = [d for d in self._docs if self._owner_of(d) != owner]
        else:
            self._docs = []
        self._persist()
        root = current_dir()
        if root is not None:
            import shutil

            if owner:
                cache = root / f"moss_session_{owner}"
                if cache.exists():
                    try:
                        shutil.rmtree(cache, ignore_errors=True)
                    except OSError:
                        pass
            else:
                for path in root.glob("moss_session*"):
                    try:
                        shutil.rmtree(path, ignore_errors=True)
                    except OSError:
                        pass
        return {"docs": len(self._docs_for(owner)) if owner else 0, "backend": self.backend}


runtime = MossRuntime()
