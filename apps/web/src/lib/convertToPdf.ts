import type { StoredAttachment } from "./attachments";
import { HOST, TOKEN_KEY } from "./config";
import { networkOnline } from "./net";

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text: string, width = 92): string[] {
  const out: string[] = [];
  for (const para of (text || "").split(/\r?\n/)) {
    const line = para.replace(/\t/g, "  ");
    if (!line.trim()) {
      out.push("");
      continue;
    }
    let buf = line;
    while (buf.length > width) {
      let cut = buf.lastIndexOf(" ", width);
      if (cut < 20) cut = width;
      out.push(buf.slice(0, cut));
      buf = buf.slice(cut).trimStart();
    }
    out.push(buf);
  }
  return out.slice(0, 2000);
}

function linesToPdf(title: string, lines: string[]): Uint8Array {
  const per = 48;
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += per) pages.push(lines.slice(i, i + per));
  const n = pages.length;
  const catalog = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  const pagesObj = `<< /Type /Pages /Count ${n} /Kids [${kids}] >>`;
  const fontId = 3 + n * 2;
  const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const built: Uint8Array[] = [enc(catalog), enc(pagesObj)];
  const encLatin = (s: string) => {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
    return out;
  };
  function enc(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  }
  for (let i = 0; i < pages.length; i++) {
    let y = 760;
    const chunks = [`BT /F1 12 Tf 48 ${y} Td (${pdfEscape(title.slice(0, 80))}) Tj ET`];
    y = 736;
    for (const ln of pages[i]) {
      y -= 14;
      if (y < 40) break;
      chunks.push(`BT /F1 10 Tf 48 ${y} Td (${pdfEscape(ln.slice(0, 118))}) Tj ET`);
    }
    const stream = encLatin(chunks.join("\n"));
    const contentId = 4 + i * 2;
    const page = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    const contentHead = `<< /Length ${stream.length} >>\nstream\n`;
    const content = concat([enc(contentHead), stream, enc("\nendstream")]);
    built.push(enc(page), content);
  }
  built.push(enc(font));
  const parts: Uint8Array[] = [enc("%PDF-1.4\n")];
  const offsets = [0];
  let size = parts[0].length;
  built.forEach((body, idx) => {
    offsets.push(size);
    const head = enc(`${idx + 1} 0 obj\n`);
    const tail = enc("\nendobj\n");
    parts.push(head, body, tail);
    size += head.length + body.length + tail.length;
  });
  const xrefAt = size;
  let xref = `xref\n0 ${built.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets.slice(1)) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  xref += `trailer << /Size ${built.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(enc(xref));
  return concat(parts);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function textPdf(name: string, text: string): { bytes: Uint8Array; filename: string } {
  const stem = name.replace(/\.[^.]+$/, "") || "document";
  const lines = wrap(text || "No extractable text.");
  return { bytes: linesToPdf(name, lines), filename: `${stem}.pdf` };
}

export async function convertAttachmentsToPdf(
  files: StoredAttachment[],
): Promise<{ filename: string; count: number }> {
  const docs = files.filter((f) => f.kind !== "image" || /\.pdf$/i.test(f.name));
  if (!docs.length) throw new Error("Attach a document (Word, Excel, CSV, slides, text, or PDF) first.");
  const token = typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
  if (networkOnline() && token && docs.length === 1 && docs[0].bytes?.byteLength) {
    const f = docs[0];
    const body = new FormData();
    body.append("file", new Blob([f.bytes], { type: f.mime || "application/octet-stream" }), f.name);
    const res = await fetch(`${HOST}/v1/convert/pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    if (res.ok) {
      const blob = await res.blob();
      const filename = /\.pdf$/i.test(f.name) ? f.name : `${f.name.replace(/\.[^.]+$/, "")}.pdf`;
      downloadBlob(blob, filename);
      return { filename, count: 1 };
    }
  }
  const chunks: string[] = [];
  for (const f of docs) {
    chunks.push(`# ${f.name}\n${(f.text || "").trim() || "(no extractable text)"}`);
  }
  const merged = textPdf(docs.length === 1 ? docs[0].name : "attachments.pdf", chunks.join("\n\n"));
  downloadBlob(new Blob([merged.bytes], { type: "application/pdf" }), merged.filename);
  return { filename: merged.filename, count: docs.length };
}
