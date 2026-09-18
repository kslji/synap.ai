#!/usr/bin/env python3
"""On-device convert-to-PDF for txt, csv, docx, xlsx."""

from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
HOST_DIR = HERE.parents[1] / "apps" / "host"
sys.path.insert(0, str(HOST_DIR))

from convert import ConvertError, convert_to_pdf  # noqa: E402


def _docx(paragraphs: list[str]) -> bytes:
    body = "".join(
        f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in paragraphs
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
        z.writestr("[Content_Types].xml", "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'></Types>")
    return buf.getvalue()


def _xlsx(rows: list[list[str]]) -> bytes:
    strings = []
    for row in rows:
        strings.extend(row)
    si = "".join(f"<si><t>{s}</t></si>" for s in strings)
    shared = (
        '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"{si}</sst>"
    )
    cells = []
    idx = 0
    xml_rows = []
    for r, row in enumerate(rows, 1):
        cxml = []
        for c, _ in enumerate(row):
            col = chr(65 + c)
            cxml.append(f'<c r="{col}{r}" t="s"><v>{idx}</v></c>')
            idx += 1
        xml_rows.append(f'<row r="{r}">{"".join(cxml)}</row>')
    sheet = (
        '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(xml_rows)}</sheetData></worksheet>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/sharedStrings.xml", shared)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def check(name: str, ok: bool, detail: str, rows: list) -> None:
    rows.append({"id": name, "ok": ok, "detail": detail})
    print(("PASS" if ok else "FAIL"), name, detail)


def run_checks() -> list[dict]:
    rows: list[dict] = []
    pdf, name = convert_to_pdf("notes.txt", b"Harbour ferry leaves Pier 4 at 06:40.\nKeep the deck log.")
    check("convert-txt-pdf", pdf.startswith(b"%PDF") and name == "notes.pdf", name, rows)
    check("convert-txt-body", b"Harbour ferry" in pdf or b"Pier 4" in pdf, "plain text in PDF", rows)

    csv_pdf, csv_name = convert_to_pdf("sales.csv", b"sku,qty\nBUN-441,12\n")
    check("convert-csv-pdf", csv_pdf.startswith(b"%PDF") and csv_name == "sales.pdf", csv_name, rows)
    check("convert-csv-sku", b"BUN-441" in csv_pdf, "csv cell in PDF", rows)

    docx = _docx(["Acme Bakery handbook", "Closed Monday."])
    dpdf, dname = convert_to_pdf("handbook.docx", docx)
    check("convert-docx-pdf", dpdf.startswith(b"%PDF") and dname.endswith(".pdf"), dname, rows)
    check("convert-docx-text", b"Closed Monday" in dpdf or b"Acme Bakery" in dpdf, "docx text", rows)

    xlsx = _xlsx([["Invoice", "INV-9921"], ["Amount", "408.50"]])
    xpdf, xname = convert_to_pdf("invoice.xlsx", xlsx)
    check("convert-xlsx-pdf", xpdf.startswith(b"%PDF") and xname == "invoice.pdf", xname, rows)
    check("convert-xlsx-inv", b"INV-9921" in xpdf or b"408.50" in xpdf, "xlsx values", rows)

    try:
        convert_to_pdf("photo.png", b"\x89PNG\r\n")
        check("convert-rejects-png", False, "should raise", rows)
    except ConvertError:
        check("convert-rejects-png", True, "ConvertError", rows)

    pptx_buf = io.BytesIO()
    with zipfile.ZipFile(pptx_buf, "w") as z:
        z.writestr(
            "ppt/slides/slide1.xml",
            '<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
            'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            "<a:t>Deck log for Pier 4</a:t></p:sld>",
        )
    ppdf, pname = convert_to_pdf("brief.pptx", pptx_buf.getvalue())
    check("convert-pptx-pdf", ppdf.startswith(b"%PDF") and pname == "brief.pdf", pname, rows)
    check("convert-pptx-text", b"Pier 4" in ppdf or b"Deck log" in ppdf, "pptx text", rows)

    def wants_pdf(q: str) -> bool:
        t = q.strip().lower()
        if not t:
            return False
        if "pdf" in t and any(w in t for w in ("convert", "export", "download", "save", "make", "turn", "render", "print")):
            return True
        return any(w in t for w in ("docx", "xlsx", "xls", "csv", "pptx", "word", "excel")) and "pdf" in t

    check("intent-convert-xlsx", wants_pdf("convert this excel sheet to pdf"), "xlsx→pdf", rows)
    check("intent-convert-docx", wants_pdf("turn the word file into a PDF"), "docx→pdf", rows)
    check("intent-not-pdf", not wants_pdf("what is this zip about"), "no convert", rows)

    return rows


def main() -> int:
    rows = run_checks()
    return 1 if any(not r["ok"] for r in rows) else 0


if __name__ == "__main__":
    sys.exit(main())
