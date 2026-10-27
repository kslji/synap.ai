"""The embedding spec a pack must be built with, read from the desktop's own registry.

A pack and the app that opens it have to agree on five values: id, dim, pooling,
query_prefix and doc_template. `specKey()` in
apps/desktop/src/main/core/embedding.ts folds them into one string and
pack-verify.ts refuses any pack whose key differs from the app's.

Those five values used to be copy-pasted into each builder as a literal dict.
Commit 66edafb moved the app off Jina's prefixed templates ("no prefixes, title
line only when there is one") and updated the registry, but not the builders - so
every pack they signed became unverifiable, which is a failure at pack-install
time in production, not just in the eval pipeline.

Reading the one copy the app ships makes that drift impossible, for the same
reason build_pack.py reads injection-rules.json instead of keeping a second
pattern set. The formatting helpers mirror formatQuery/formatDoc in
embedding.ts byte for byte: a pack whose vectors were built from different text
than the app would search with is exactly the kind of silent corruption the
compatibility key exists to catch, so matching the strings but not the formatting
would still be wrong.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = REPO_ROOT / "apps" / "desktop" / "resources" / "models.registry.json"

# Hugging Face repo of the original weights. Provenance for the manifest only: it is
# not part of specKey, and the registry names the GGUF the desktop runs instead.
HF_MODEL = "jinaai/jina-embeddings-v2-base-code"


def _embedding_row() -> dict:
    registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    rows = [m for m in registry["models"] if m.get("role") == "embedding"]
    if len(rows) != 1:
        raise SystemExit(
            f"{REGISTRY_PATH} must hold exactly one role=embedding row, found {len(rows)}"
        )
    return rows[0]


_ROW = _embedding_row()

# The shape manifest.json["embedding"] is written in, and the field names the desktop's
# PackManifest schema parses. normalize is fixed: the app L2-re-normalises after the
# Matryoshka slice and nothing else is supported.
SPEC: dict = {
    "id": _ROW["spec_id"],
    "model": HF_MODEL,
    "file": _ROW["file"],
    "native_dim": int(_ROW["native_dim"]),
    "dim": int(_ROW["dim"]),
    "pooling": _ROW["pooling"],
    "normalize": True,
    "query_prefix": _ROW["query_prefix"],
    "doc_template": _ROW["doc_template"],
}


def format_query(query: str) -> str:
    """embedding.ts formatQuery: prefix, then the trimmed query."""
    return SPEC["query_prefix"] + query.strip()


def format_doc(title: str | None, text: str) -> str:
    """embedding.ts formatDoc: title first, and the title line dropped when empty.

    The leading newline is stripped when there is no title, so a titleless document is
    embedded as bare text rather than "\n<text>" - the difference the app considers a
    different document.
    """
    head = " ".join(title.split()) if title and title.strip() else ""
    doc = SPEC["doc_template"].replace("{title}", head).replace("{text}", text.strip())
    return doc if head else re.sub(r"^\n+", "", doc)
