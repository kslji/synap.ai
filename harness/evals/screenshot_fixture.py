"""Small screenshot fixtures and the error lines read out of them.

The glyphs are a fixed 5x7 font. Reading them does not need a model or tesseract.
The Code agent uses the same error-line rules after OCR.
"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

SCALE = 2
MARGIN = 2
GLYPH_W = 5
GLYPH_H = 7

# 5-bit rows, left bit is the high bit. Each glyph is unique.
FONT: dict[str, tuple[int, ...]] = {
    " ": (0, 0, 0, 0, 0, 0, 0),
    ":": (0, 4, 0, 0, 4, 0, 0),
    "1": (4, 12, 4, 4, 4, 4, 14),
    "2": (14, 17, 1, 6, 8, 16, 31),
    "A": (14, 17, 17, 31, 17, 17, 17),
    "E": (31, 16, 16, 28, 16, 16, 31),
    "T": (31, 4, 4, 4, 4, 4, 4),
    "a": (0, 0, 14, 1, 15, 17, 15),
    "c": (0, 0, 14, 16, 16, 16, 14),
    "d": (1, 1, 15, 17, 17, 17, 15),
    "e": (0, 0, 14, 17, 31, 16, 14),
    "f": (6, 8, 8, 30, 8, 8, 8),
    "i": (4, 0, 12, 4, 4, 4, 14),
    "l": (12, 4, 4, 4, 4, 4, 14),
    "n": (0, 0, 26, 21, 17, 17, 17),
    "o": (0, 0, 14, 17, 17, 17, 14),
    "p": (0, 0, 30, 17, 30, 16, 16),
    "q": (0, 0, 15, 17, 15, 1, 1),
    "r": (0, 0, 22, 24, 16, 16, 16),
    "s": (0, 0, 15, 16, 14, 1, 30),
    "t": (8, 8, 30, 8, 8, 8, 6),
    "u": (0, 0, 17, 17, 17, 17, 15),
    "x": (0, 0, 17, 10, 4, 10, 17),
    "y": (0, 0, 17, 17, 15, 1, 14),
}


def _chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def _rows(text: str) -> list[bytearray]:
    width = MARGIN + len(text) * (GLYPH_W + 1) * SCALE + MARGIN
    height = MARGIN + GLYPH_H * SCALE + MARGIN
    rows = [bytearray([255, 255, 255]) * width for _ in range(height)]
    for index, char in enumerate(text):
        glyph = FONT[char]
        origin_x = MARGIN + index * (GLYPH_W + 1) * SCALE
        origin_y = MARGIN
        for gy, bits in enumerate(glyph):
            for gx in range(GLYPH_W):
                if (bits >> (GLYPH_W - 1 - gx)) & 1 == 0:
                    continue
                for dy in range(SCALE):
                    for dx in range(SCALE):
                        px = origin_x + gx * SCALE + dx
                        py = origin_y + gy * SCALE + dy
                        start = px * 3
                        rows[py][start : start + 3] = b"\x00\x00\x00"
    return rows


def write_png(text: str) -> bytes:
    rows = _rows(text)
    height = len(rows)
    width = len(rows[0]) // 3
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", zlib.compress(raw)) + _chunk(b"IEND", b"")


def _read_png(blob: bytes) -> list[bytes]:
    if not blob.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("not a png")
    pos = 8
    width = height = 0
    idat = b""
    while pos + 8 <= len(blob):
        length = struct.unpack(">I", blob[pos : pos + 4])[0]
        tag = blob[pos + 4 : pos + 8]
        data = blob[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height = struct.unpack(">II", data[:8])
        elif tag == b"IDAT":
            idat += data
        elif tag == b"IEND":
            break
    raw = zlib.decompress(idat)
    stride = width * 3
    rows: list[bytes] = []
    cursor = 0
    for _ in range(height):
        if raw[cursor] != 0:
            raise ValueError("filtered png")
        cursor += 1
        rows.append(raw[cursor : cursor + stride])
        cursor += stride
    return rows


def read_screenshot(blob: bytes) -> str:
    rows = _read_png(blob)
    if not rows:
        return ""
    width = len(rows[0]) // 3
    chars: list[str] = []
    index = 0
    while True:
        origin_x = MARGIN + index * (GLYPH_W + 1) * SCALE
        if origin_x + GLYPH_W * SCALE > width - MARGIN:
            break
        bits: list[int] = []
        for gy in range(GLYPH_H):
            value = 0
            for gx in range(GLYPH_W):
                dark = 0
                for dy in range(SCALE):
                    for dx in range(SCALE):
                        px = origin_x + gx * SCALE + dx
                        py = MARGIN + gy * SCALE + dy
                        if rows[py][px * 3] < 128:
                            dark += 1
                if dark * 2 >= SCALE * SCALE:
                    value |= 1 << (GLYPH_W - 1 - gx)
            bits.append(value)
        found = next((char for char, glyph in FONT.items() if list(glyph) == bits), None)
        if found is None:
            raise ValueError(f"unknown glyph at {index}: {bits}")
        chars.append(found)
        index += 1
    return "".join(chars).rstrip()


def extract_error_lines(text: str) -> list[str]:
    import re

    error = re.compile(r"\b(TypeError|ReferenceError|SyntaxError|AssertionError|Exception|Traceback|FAILED|Error|panic)\b", re.I)
    at_line = re.compile(r"^at\s+\S+")
    py_line = re.compile(r'File ".+", line \d+')
    out: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if error.search(line) or at_line.match(line) or py_line.search(line):
            if line not in out:
                out.append(line)
        if len(out) >= 12:
            break
    return out


FIXTURES = {
    "type-error.png": "TypeError: x is not a function",
    "assertion-error.png": "AssertionError: expected 1 to equal 2",
}


def write_fixtures(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    seen = {tuple(glyph) for glyph in FONT.values()}
    if len(seen) != len(FONT):
        raise SystemExit("font glyphs are not unique")
    for name, text in FIXTURES.items():
        blob = write_png(text)
        (directory / name).write_bytes(blob)
        if read_screenshot(blob) != text:
            raise SystemExit(f"round-trip failed for {name}")


if __name__ == "__main__":
    here = Path(__file__).resolve().parent / "fixtures" / "screenshots"
    write_fixtures(here)
    print("wrote", here)
