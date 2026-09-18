"""Turn office files into a simple on-device PDF. Stdlib only — no cloud."""

from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path


class ConvertError(ValueError):
    pass


def convert_to_pdf(name: str, data: bytes, mime: str = "") -> tuple[bytes, str]:
    if not data:
        raise ConvertError("The file is empty.")
    stem = Path(name or "document").stem or "document"
    out_name = stem + ".pdf"
    lower = (name or "").lower()
    mime = (mime or "").lower()
    if lower.endswith(".pdf") or "application/pdf" in mime:
        if data[:4] == b"%PDF":
            return data, name if lower.endswith(".pdf") else out_name
        raise ConvertError("That PDF could not be read.")
    title = Path(name).name or "Document"
    if lower.endswith(".docx") or "wordprocessingml" in mime:
        lines = _docx_lines(data)
    elif lower.endswith((".xlsx", ".xlsm")) or "spreadsheetml" in mime:
        lines = _xlsx_lines(data)
    elif lower.endswith(".pptx") or "presentationml" in mime:
        lines = _pptx_lines(data)
    elif lower.endswith(".csv") or mime == "text/csv":
        lines = _csv_lines(data)
    elif lower.endswith((".txt", ".md", ".markdown", ".log", ".json", ".html", ".htm")):
        lines = _plain_lines(data)
    else:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ConvertError(
                "This file type is not converted here. Attach .docx, .xlsx, .csv, .pptx, .txt, .md, or .pdf."
            ) from exc
        lines = _wrap(text)
    if not any(ln.strip() for ln in lines):
        raise ConvertError("No readable text was found in that file.")
    return _lines_to_pdf(title, lines), out_name


def _plain_lines(data: bytes) -> list[str]:
    text = data.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    return _wrap(text)


def _csv_lines(data: bytes) -> list[str]:
    text = data.decode("utf-8", errors="replace")
    rows = []
    for raw in text.splitlines()[:80]:
        cells = [c.strip().strip('"') for c in raw.split(",")]
        rows.append("  |  ".join(cells[:12]))
    return rows or _wrap(text)


def _strip_xml(xml: str) -> str:
    text = re.sub(r"<[^>]+>", " ", xml)
    return re.sub(r"\s+", " ", text).strip()


def _docx_lines(data: bytes) -> list[str]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    except Exception as exc:
        raise ConvertError(f"Could not read the Word file ({exc}).") from exc
    root = ET.fromstring(xml)
    paras: list[str] = []
    for p in root.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p"):
        bits = [
            t.text or ""
            for t in p.iter("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t")
        ]
        line = "".join(bits).strip()
        if line:
            paras.append(line)
    return _wrap("\n".join(paras) if paras else _strip_xml(xml))


def _xlsx_shared(z: zipfile.ZipFile) -> list[str]:
    try:
        xml = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(xml)
    out: list[str] = []
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    for si in root.findall(ns + "si"):
        texts = [t.text or "" for t in si.iter(ns + "t")]
        out.append("".join(texts))
    return out


def _col_index(ref: str) -> int:
    letters = "".join(c for c in ref if c.isalpha())
    n = 0
    for c in letters:
        n = n * 26 + (ord(c.upper()) - 64)
    return max(0, n - 1)


def _xlsx_lines(data: bytes) -> list[str]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        sheet = z.read("xl/worksheets/sheet1.xml")
    except Exception as exc:
        raise ConvertError(f"Could not read the spreadsheet ({exc}).") from exc
    shared = _xlsx_shared(z)
    root = ET.fromstring(sheet)
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rows_out: list[str] = []
    for i, row in enumerate(root.iter(ns + "row")):
        if i >= 60:
            break
        cells: dict[int, str] = {}
        for c in row.findall(ns + "c"):
            ref = c.attrib.get("r", "A1")
            idx = _col_index(ref)
            v = c.find(ns + "v")
            raw = v.text if v is not None and v.text else ""
            if c.attrib.get("t") == "s" and raw.isdigit() and int(raw) < len(shared):
                raw = shared[int(raw)]
            cells[idx] = raw
        if not cells:
            continue
        width = min(max(cells) + 1, 10)
        line = "  |  ".join(cells.get(j, "") for j in range(width))
        if line.strip(" |"):
            rows_out.append(line)
    return rows_out or shared[:80]


def _pptx_lines(data: bytes) -> list[str]:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        names = sorted(n for n in z.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml"))
    except Exception as exc:
        raise ConvertError(f"Could not read the slides ({exc}).") from exc
    lines: list[str] = []
    for i, n in enumerate(names[:40], 1):
        xml = z.read(n).decode("utf-8", errors="replace")
        lines.append(f"Slide {i}")
        lines.extend(_wrap(_strip_xml(xml), width=88))
        lines.append("")
    return lines


def _wrap(text: str, width: int = 92) -> list[str]:
    lines: list[str] = []
    for para in (text or "").splitlines() or [""]:
        para = para.replace("\t", "  ")
        if not para.strip():
            lines.append("")
            continue
        buf = para
        while len(buf) > width:
            cut = buf.rfind(" ", 0, width)
            if cut < 20:
                cut = width
            lines.append(buf[:cut])
            buf = buf[cut:].lstrip()
        lines.append(buf)
    return lines[:2000]


def _pdf_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _lines_to_pdf(title: str, lines: list[str]) -> bytes:
    per_page = 48
    pages = [lines[i : i + per_page] for i in range(0, max(len(lines), 1), per_page)]
    n = len(pages)
    catalog = b"<< /Type /Catalog /Pages 2 0 R >>"
    page_refs = " ".join(f"{3 + i * 2} 0 R" for i in range(n))
    pages_obj = f"<< /Type /Pages /Count {n} /Kids [{page_refs}] >>".encode()
    font_obj_id = 3 + n * 2
    font = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
    built: list[bytes] = [catalog, pages_obj]
    for i, page_lines in enumerate(pages):
        y = 760
        chunks = [f"BT /F1 12 Tf 48 {y} Td ({_pdf_escape(title[:80])}) Tj ET"]
        y = 736
        for ln in page_lines:
            y -= 14
            if y < 40:
                break
            chunks.append(f"BT /F1 10 Tf 48 {y} Td ({_pdf_escape(ln[:118])}) Tj ET")
        stream = "\n".join(chunks).encode("latin-1", errors="replace")
        content_id = 4 + i * 2
        page = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_obj_id} 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode()
        content = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
        built.append(page)
        built.append(content)
    built.append(font)

    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, body in enumerate(built, 1):
        offsets.append(len(out))
        out.extend(f"{i} 0 obj\n".encode())
        out.extend(body)
        out.extend(b"\nendobj\n")
    xref = len(out)
    out.extend(f"xref\n0 {len(built) + 1}\n".encode())
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode())
    out.extend(
        f"trailer << /Size {len(built) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    )
    return bytes(out)
