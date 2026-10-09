"""
Reference implementation of the desktop retrieval + relevance gate (the real one lives in
TypeScript main process: code-samples/ts/retrieval.ts). Useful for tuning thresholds against golden Q&A sets.
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field

import sqlite_vec

RRF_K = 60


@dataclass
class Hit:
    db: str
    chunk_id: int
    text: str = ""
    title: str = ""
    url: str = ""
    cosine: float = 0.0          # 1 - cosine distance (vector similarity)
    bm25_rank: int | None = None
    vec_rank: int | None = None
    rrf: float = 0.0
    extra: dict = field(default_factory=dict)


def fts_query(q: str) -> str:
    """Turn free text into a safe FTS5 OR-query of quoted terms (avoids syntax errors)."""
    terms = [t for t in re.findall(r"[\w\-]+", q.lower()) if len(t) > 2]
    return " OR ".join(f'"{t}"' for t in terms[:16]) or '""'


def search_db(name: str, db: sqlite3.Connection, query: str, qvec: bytes, k: int = 30) -> list[Hit]:
    hits: dict[int, Hit] = {}
    for rank, (cid,) in enumerate(db.execute(
            "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?",
            (fts_query(query), k))):
        hits.setdefault(cid, Hit(name, cid)).bm25_rank = rank
    for rank, (cid, dist) in enumerate(db.execute(
            "SELECT chunk_id, distance FROM chunk_vec WHERE embedding MATCH ? AND k = ?", (qvec, k))):
        h = hits.setdefault(cid, Hit(name, cid))
        h.vec_rank, h.cosine = rank, 1.0 - dist
    for h in hits.values():
        h.rrf = sum(1.0 / (RRF_K + r + 1) for r in (h.bm25_rank, h.vec_rank) if r is not None)
        row = db.execute("SELECT c.text, d.title, d.url FROM chunks c JOIN documents d ON d.id=c.doc_id "
                         "WHERE c.id=?", (h.chunk_id,)).fetchone()
        h.text, h.title, h.url = row
    return list(hits.values())


def term_coverage(query: str, hits: list[Hit]) -> float:
    terms = {t for t in re.findall(r"[\w\-]+", query.lower()) if len(t) > 3}
    if not terms:
        return 0.0
    blob = " ".join(h.text.lower() for h in hits)
    return sum(t in blob for t in terms) / len(terms)


def gate(query: str, hits: list[Hit], tau_cos: float = 0.70, tau_cov: float = 0.5) -> str:
    """'answer' | 'borderline' | 'insufficient'. Thresholds come from the agent manifest
    and MUST be calibrated per embedding model on a golden set (EmbeddingGemma 2 @256: unrelated text
    still scores ~0.5, related ~0.85 in our tests - so the threshold is NOT portable from other models)."""
    if not hits:
        return "insufficient"
    best = max(h.cosine for h in hits)
    cov = term_coverage(query, hits[:5])
    if best >= tau_cos and cov >= tau_cov:
        return "answer"
    if best >= tau_cos - 0.08 or cov >= tau_cov:
        return "borderline"      # -> ask the LLM a yes/no 'is the answer in these sources?'
    return "insufficient"        # -> web search if online+allowed, else refuse


def hybrid_search(dbs: dict[str, sqlite3.Connection], query: str, qvec: bytes, top_n: int = 6):
    hits = [h for name, db in dbs.items() for h in search_db(name, db, query, qvec)]
    hits.sort(key=lambda h: h.rrf, reverse=True)
    top = hits[:top_n]
    return top, gate(query, top)


if __name__ == "__main__":
    import sys
    db = sqlite3.connect("dist/packs/marine-core/2026.10.08/pack.sqlite")
    db.enable_load_extension(True); sqlite_vec.load(db)
    q = sys.argv[1] if len(sys.argv) > 1 else "maritime safety committee amendments"
    # query embedding: same spec as the pack (prefix + 256-d truncation + re-normalisation)
    from embedding_spec import LlamaEmbedder
    qvec = sqlite_vec.serialize_float32(LlamaEmbedder().embed_queries([q])[0])
    top, decision = hybrid_search({"marine-core": db}, q, qvec)
    for h in top:
        print(f"{h.rrf:.4f} cos={h.cosine:.2f} bm25#{h.bm25_rank} vec#{h.vec_rank} {h.title[:60]!r}")
    print("gate:", decision)
