#!/usr/bin/env python3
"""ZIP unpack + path parse must not claim 'no file paths' for real project archives.

Covers:
- pathsFromFiles accepts flat and nested tree bullets
- pack/local zip extractor uses central directory (data-descriptor safe)
- summary-files sidebar markup (not a single overflowing green line)
"""

from __future__ import annotations

import re
import struct
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
GROUNDED = ROOT / "apps" / "web" / "src" / "lib" / "groundedContext.ts"
ATTACH = ROOT / "apps" / "web" / "src" / "lib" / "attachments.ts"
PACK_HTML = ROOT / "apps" / "web" / "public" / "local-agent.html"
DATA_CARD = ROOT / "apps" / "web" / "src" / "components" / "LocalDataCard.tsx"
CSS = ROOT / "apps" / "web" / "src" / "app" / "globals.css"


def paths_from_files(text: str) -> list[str]:
    """Mirror groundedContext.pathsFromFiles for harness."""
    paths: list[str] = []

    def push(raw: str) -> None:
        norm = (
            str(raw or "")
            .strip()
            .replace("\\", "/")
            .lstrip("./")
        )
        norm = re.sub(r"^[-*`]+", "", norm).rstrip("/")
        if not norm or len(norm) > 180:
            return
        if re.match(
            r"^(https?:|mailto:|file tree|extracted zip|no plain-text|summarize from|folder questions)",
            norm,
            re.I,
        ):
            return
        if "/" not in norm and not re.search(r"\.[A-Za-z0-9]{1,12}$", norm):
            if not re.match(r"^[A-Za-z0-9._-]+$", norm):
                return
        if not re.search(r"[A-Za-z0-9._-]+", norm):
            return
        paths.append(norm)

    for line in text.splitlines():
        raw_line = line.strip()
        if not raw_line:
            continue
        if raw_line.startswith("---"):
            continue
        t = re.sub(r"^\d+\.\s*", "", raw_line)
        t = re.sub(r"^[-*•]\s*", "", t)
        if not t:
            continue
        if re.match(r"^file tree", t, re.I):
            after = re.sub(r"^file tree[^:]*:\s*", "", t, flags=re.I)
            if after and after != t:
                for part in after.split():
                    push(part)
            continue
        if re.match(r"^(extracted zip|summarize from|folder questions)", t, re.I):
            continue
        if "/" in t or t.endswith("/") or re.search(r"\.[A-Za-z0-9]{1,12}$", t) or re.match(
            r"^[A-Za-z0-9._-]{1,80}$", t
        ):
            push(t.rstrip("/"))
    if not paths:
        for m in re.finditer(r"---\s+([^\n]+?)\s+---", text):
            push(m.group(1))
    # unique preserve order
    seen: set[str] = set()
    out: list[str] = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def explain_zip_has_paths(name: str, raw: str) -> bool:
    paths = paths_from_files(raw)
    return len(paths) > 0 and "no file paths" not in raw.lower()


def u16(n: int) -> bytes:
    return struct.pack("<H", n)


def u32(n: int) -> bytes:
    return struct.pack("<I", n)


def build_zip_with_data_descriptor(entries: list[tuple[str, bytes]]) -> bytes:
    """Build a ZIP where local headers use bit 3 (size 0) — the bug class that broke harbour zips."""
    locals_blob = b""
    centrals = b""
    offset = 0
    for name, body in entries:
        name_b = name.encode("utf-8")
        crc = zlib.crc32(body) & 0xFFFFFFFF
        # store uncompressed for simplicity
        method = 0
        flags = 0x8  # data descriptor
        local = (
            u32(0x04034B50)
            + u16(20)
            + u16(flags)
            + u16(method)
            + u16(0)
            + u16(0)
            + u32(0)  # crc placeholder
            + u32(0)  # comp size
            + u32(0)  # uncomp size
            + u16(len(name_b))
            + u16(0)
            + name_b
            + body
            + u32(0x08074B50)
            + u32(crc)
            + u32(len(body))
            + u32(len(body))
        )
        local_off = offset
        locals_blob += local
        offset += len(local)
        centrals += (
            u32(0x02014B50)
            + u16(20)
            + u16(20)
            + u16(flags)
            + u16(method)
            + u16(0)
            + u16(0)
            + u32(crc)
            + u32(len(body))
            + u32(len(body))
            + u16(len(name_b))
            + u16(0)
            + u16(0)
            + u16(0)
            + u16(0)
            + u32(0)
            + u32(local_off)
            + name_b
        )
    eocd = (
        u32(0x06054B50)
        + u16(0)
        + u16(0)
        + u16(len(entries))
        + u16(len(entries))
        + u32(len(centrals))
        + u32(len(locals_blob))
        + u16(0)
    )
    return locals_blob + centrals + eocd


def zip_names_from_central(data: bytes) -> list[str]:
    """Python mirror of central-directory name listing (no inflate needed for stored)."""
    eocd = data.rfind(b"PK\x05\x06")
    if eocd < 0:
        return []
    total = struct.unpack_from("<H", data, eocd + 10)[0]
    offset = struct.unpack_from("<I", data, eocd + 16)[0]
    names: list[str] = []
    for _ in range(total):
        if offset + 46 > len(data) or struct.unpack_from("<I", data, offset)[0] != 0x02014B50:
            break
        name_len = struct.unpack_from("<H", data, offset + 28)[0]
        extra_len = struct.unpack_from("<H", data, offset + 30)[0]
        comment_len = struct.unpack_from("<H", data, offset + 32)[0]
        name = data[offset + 46 : offset + 46 + name_len].decode("utf-8", "replace")
        offset += 46 + name_len + extra_len + comment_len
        if not name.endswith("/"):
            names.append(name)
    return names


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    grounded = GROUNDED.read_text(encoding="utf-8") if GROUNDED.exists() else ""
    attach = ATTACH.read_text(encoding="utf-8") if ATTACH.exists() else ""
    html = PACK_HTML.read_text(encoding="utf-8") if PACK_HTML.exists() else ""
    card = DATA_CARD.read_text(encoding="utf-8") if DATA_CARD.exists() else ""
    css = CSS.read_text(encoding="utf-8") if CSS.exists() else ""

    check(
        "source-zip-central-directory-ts",
        "zipEntriesFromCentral" in attach and "findZipEocd" in attach,
        "attachments.ts reads ZIP central directory",
        rows,
    )
    check(
        "source-zip-central-directory-pack",
        "findZipEocd" in html and "0x02014b50" in html and "flags & 8 && !compSize) break" not in html,
        "local-agent extractZip no longer breaks on data-descriptor bit",
        rows,
    )
    check(
        "source-pathsFromFiles-accepts-flat",
        "A-Za-z0-9]{1,12}" in grounded and "matchAll" in grounded,
        "pathsFromFiles accepts bare files + --- headers",
        rows,
    )
    check(
        "source-summary-files-css",
        "summary-files" in css and "overflow-wrap: anywhere" in css,
        "globals.css wraps long summary filenames",
        rows,
    )
    check(
        "source-summary-files-pack",
        'class="summary-files"' in html and "Files in latest summary" in html,
        "pack sidebar uses summary-files list, not overflowing green line",
        rows,
    )
    check(
        "source-summary-files-web",
        "summary-files" in card and "Files in this summary" in card,
        "LocalDataCard lists summary files",
        rows,
    )

    nested = (
        'Extracted zip "harbour-agent-OP1.zip". This IS the project.\n'
        "File tree (4 paths):\n"
        "- harbour-agent-OP1/README.md\n"
        "- harbour-agent-OP1/src/main.py\n"
        "- harbour-agent-OP1/package.json\n"
        "- harbour-agent-OP1/cli.ts\n"
        "\n--- harbour-agent-OP1/README.md ---\n"
        "Harbour agent orchestrates local packs.\n"
    )
    paths = paths_from_files(nested)
    check(
        "paths-nested-harbour",
        "harbour-agent-OP1/README.md" in paths
        and "harbour-agent-OP1/src/main.py" in paths
        and not any("---" in p for p in paths),
        f"got={paths[:6]}",
        rows,
    )
    check(
        "explain-nested-not-empty",
        explain_zip_has_paths("harbour-agent-OP1.zip", nested),
        "must not claim no file paths",
        rows,
    )

    flat = (
        'Extracted zip "tools.zip".\nFile tree (2 paths):\n- README.md\n- main.py\n'
        "\n--- README.md ---\nTools for local agents.\n"
    )
    flat_paths = paths_from_files(flat)
    check(
        "paths-flat-readme",
        "README.md" in flat_paths and "main.py" in flat_paths,
        f"got={flat_paths}",
        rows,
    )

    empty_bad = 'Extracted zip "x.zip".\nFile tree (0 paths):\n'
    check(
        "paths-empty-tree",
        paths_from_files(empty_bad) == [],
        "empty tree stays empty",
        rows,
    )

    # Data-descriptor ZIP: central directory must still list names
    zbytes = build_zip_with_data_descriptor(
        [
            ("harbour-agent-OP1/README.md", b"# Harbour agent\nLocal pack runner.\n"),
            ("harbour-agent-OP1/src/cli.py", b"print('harbour')\n"),
        ]
    )
    cd_names = zip_names_from_central(zbytes)
    check(
        "zip-data-descriptor-central-names",
        "harbour-agent-OP1/README.md" in cd_names and "harbour-agent-OP1/src/cli.py" in cd_names,
        f"names={cd_names}",
        rows,
    )
    # Simulate extract text the pack would produce once CD parse works
    sim = (
        'Extracted zip "harbour-agent-OP1.zip". This IS the project. Summarize from the tree and excerpts.\n'
        f"File tree ({len(cd_names)} paths):\n"
        + "\n".join(f"- {n}" for n in cd_names)
        + "\n\n--- harbour-agent-OP1/README.md ---\n# Harbour agent Local pack runner.\n"
    )
    check(
        "zip-data-descriptor-overview-paths",
        len(paths_from_files(sim)) >= 2,
        "overview would list real paths after CD unpack",
        rows,
    )
    check(
        "pack-no-legacy-break-on-bit3",
        "if (flags & 8 && !compSize) break" not in html and "if (flags & 8 && !compSize) break;" not in html,
        "legacy early-break removed from local-agent.html",
        rows,
    )
    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
