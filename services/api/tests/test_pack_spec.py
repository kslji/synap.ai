"""The pack builders and the desktop must agree on the embedding compatibility key.

pack-verify.ts refuses any pack whose specKey differs from the app's JINA_CODE_256, and
it compares five values. Two of them (id, dim) are the ones that show up in the error
message, so a drift in query_prefix or doc_template is the worst kind: the builders keep
signing, and every install then fails at verification time. That is what commit 66edafb
caused - it moved the app off Jina's prefixed templates and left the builders' literals
behind. These tests read both sides of the boundary instead of trusting either.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "services" / "packs"))

import build_delta  # noqa: E402
import build_pack  # noqa: E402
import pack_spec  # noqa: E402

EMBEDDING_TS = ROOT / "apps" / "desktop" / "src" / "main" / "core" / "embedding.ts"
REGISTRY_JSON = ROOT / "apps" / "desktop" / "resources" / "models.registry.json"

# specKey() in embedding.ts: these five, in this order.
KEY_FIELDS = ("id", "dim", "pooling", "queryPrefix", "docTemplate")


def app_spec_from_typescript() -> dict:
    """The compiled-in spec the desktop verifies against, parsed out of embedding.ts.

    The only way to cross-check a Python constant against a TypeScript one, and the
    point of this file: the app never reads the registry for this, it reads JINA_CODE_256.
    """
    source = EMBEDDING_TS.read_text(encoding="utf-8")
    start = source.index("export const JINA_CODE_256: EmbeddingSpec = {")
    block = source[start : source.index("};", start)]
    field = re.compile(r"^\s*(\w+):\s*(.+?),\s*$", re.MULTILINE)
    found = {}
    for name, raw in field.findall(block):
        value = raw.strip()
        if value.startswith("'"):
            found[name] = value[1:-1].replace("\\n", "\n")
        elif value.isdigit():
            found[name] = int(value)
    return found


def registry_embedding_row() -> dict:
    registry = json.loads(REGISTRY_JSON.read_text(encoding="utf-8"))
    rows = [m for m in registry["models"] if m.get("role") == "embedding"]
    assert len(rows) == 1, f"expected one embedding row, got {len(rows)}"
    return rows[0]


def key(spec: dict) -> list:
    return [spec["id"], spec["dim"], spec["pooling"], spec["query_prefix"], spec["doc_template"]]


def test_builders_agree_with_the_desktop_spec():
    ts = app_spec_from_typescript()
    for name in KEY_FIELDS:
        assert name in ts, f"embedding.ts no longer defines {name} the way this test can read it"
    assert key(pack_spec.SPEC) == [
        ts["id"],
        ts["dim"],
        ts["pooling"],
        ts["queryPrefix"],
        ts["docTemplate"],
    ], "pack builders and JINA_CODE_256 disagree - verifyPack would refuse every signed pack"


def test_both_builders_read_the_one_spec():
    # Assigning a fresh dict in a builder is how the drift got in; they must share the module.
    assert build_pack.SPEC is pack_spec.SPEC
    assert build_delta.SPEC is pack_spec.SPEC


def test_the_spec_is_not_copied_back_into_a_literal():
    row = registry_embedding_row()
    assert key(pack_spec.SPEC) == [row["spec_id"], row["dim"], row["pooling"], row["query_prefix"], row["doc_template"]]
    assert pack_spec.SPEC["native_dim"] == row["native_dim"]
    assert pack_spec.SPEC["file"] == row["file"]


def test_doc_formatting_matches_the_desktop():
    """formatDoc in embedding.ts, case for case."""
    assert pack_spec.format_doc("Marine Signals", "buoy 7 lit") == "Marine Signals\nbuoy 7 lit"
    # No title: the whole title line goes, including its newline - never "\ntext".
    assert pack_spec.format_doc("", "buoy 7 lit") == "buoy 7 lit"
    assert pack_spec.format_doc(None, "buoy 7 lit") == "buoy 7 lit"
    assert pack_spec.format_doc("   ", "buoy 7 lit") == "buoy 7 lit"
    # A title is collapsed to one line before it is embedded.
    assert pack_spec.format_doc("Marine\n  Signals", "text") == "Marine Signals\ntext"
    # Text is trimmed, and the template is not hardcoded here.
    assert pack_spec.format_doc("t", "  padded  \n") == "t\npadded"


def test_query_formatting_matches_the_desktop():
    assert pack_spec.format_query("  engine overheats  ") == pack_spec.SPEC["query_prefix"] + "engine overheats"
