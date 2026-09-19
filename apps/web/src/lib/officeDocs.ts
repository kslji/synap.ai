/**
 * Office / spreadsheet text extractors (AnythingLLM-style: real sheet grids, not
 * sharedStrings alone). Pure OOXML — no SheetJS, works offline in the browser.
 */

function stripXml(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<a:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function colRow(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((x) =>
      x[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"'),
    );
    out.push(parts.join(""));
  }
  return out;
}

function sheetToTsv(xml: string, strings: string[]): string {
  const cells = new Map<string, string>();
  let maxR = 0;
  let maxC = 0;
  const re = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1] || m[3] || "";
    const body = m[2] || "";
    const ref = /\br="([^"]+)"/i.exec(attrs)?.[1];
    if (!ref) continue;
    const pos = colRow(ref);
    if (!pos) continue;
    maxR = Math.max(maxR, pos.row);
    maxC = Math.max(maxC, pos.col);
    const type = /\bt="([^"]+)"/i.exec(attrs)?.[1] || "";
    let val = "";
    if (type === "s") {
      const idx = Number(/<v>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? "");
      val = Number.isFinite(idx) ? strings[idx] ?? "" : "";
    } else if (type === "inlineStr" || type === "str") {
      val = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)].map((x) => x[1]).join("") || stripXml(body);
    } else if (type === "b") {
      val = /<v>([\s\S]*?)<\/v>/i.exec(body)?.[1] === "1" ? "TRUE" : "FALSE";
    } else {
      val = /<v>([\s\S]*?)<\/v>/i.exec(body)?.[1]?.trim() || "";
    }
    cells.set(`${pos.row}:${pos.col}`, val.replace(/\t|\n/g, " ").trim());
  }
  if (!cells.size) return "";
  const rows: string[] = [];
  const limitR = Math.min(maxR, 400);
  const limitC = Math.min(maxC, 40);
  for (let r = 0; r <= limitR; r++) {
    const cols: string[] = [];
    let any = false;
    for (let c = 0; c <= limitC; c++) {
      const v = cells.get(`${r}:${c}`) || "";
      if (v) any = true;
      cols.push(v);
    }
    if (any) rows.push(cols.join("\t"));
  }
  return rows.join("\n");
}

export async function extractDocxText(
  zipText: (path: string) => Promise<string | null>,
  name: string,
): Promise<string> {
  const xml = await zipText("word/document.xml");
  if (!xml) return `Word file "${name}" stored locally. Could not read document.xml.`;
  const body = stripXml(xml);
  return body || `Word file "${name}" stored locally. No readable paragraphs.`;
}

export async function extractPptxText(
  zipCollect: (pred: (name: string) => boolean) => Promise<string[]>,
  name: string,
): Promise<string> {
  const slides = await zipCollect((p) => p.startsWith("ppt/slides/slide") && p.endsWith(".xml"));
  if (!slides.length) return `PowerPoint "${name}" stored locally. Could not read slides.`;
  return slides.map((s, i) => `### Slide ${i + 1}\n${stripXml(s)}`).join("\n\n");
}

export async function extractXlsxText(
  zipEntries: () => Promise<Array<{ name: string; text: string }>>,
  name: string,
): Promise<string> {
  const entries = await zipEntries();
  const byName = new Map(entries.map((e) => [e.name, e.text]));
  const shared = sharedStrings(byName.get("xl/sharedStrings.xml") || "");
  const workbook = byName.get("xl/workbook.xml") || "";
  const sheetMeta: Array<{ name: string; path: string }> = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/gi;
  let sm: RegExpExecArray | null;
  const idToPath = new Map<string, string>();
  const rels = byName.get("xl/_rels/workbook.xml.rels") || "";
  const relRe = /<Relationship\b([^>]*)\/?>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = relRe.exec(rels))) {
    const attrs = rm[1];
    const id = /\bId="([^"]+)"/i.exec(attrs)?.[1];
    const target = /\bTarget="([^"]+)"/i.exec(attrs)?.[1];
    if (id && target) {
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      idToPath.set(id, path.replace(/\\/g, "/"));
    }
  }
  while ((sm = sheetRe.exec(workbook))) {
    const attrs = sm[1];
    const title = /\bname="([^"]+)"/i.exec(attrs)?.[1] || "Sheet";
    const rid = /\br:id="([^"]+)"/i.exec(attrs)?.[1] || /\bId="([^"]+)"/i.exec(attrs)?.[1];
    const path = (rid && idToPath.get(rid)) || "";
    if (path) sheetMeta.push({ name: title, path });
  }
  if (!sheetMeta.length) {
    for (const e of entries) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(e.name)) {
        sheetMeta.push({ name: e.name.split("/").pop() || "Sheet", path: e.name });
      }
    }
  }
  const parts: string[] = [`Spreadsheet "${name}" (${sheetMeta.length || 1} sheet(s)). Values as tab-separated rows.`];
  for (const sheet of sheetMeta.slice(0, 12)) {
    const xml = byName.get(sheet.path) || "";
    const grid = sheetToTsv(xml, shared);
    if (grid.trim()) parts.push(`### Sheet: ${sheet.name}\n${grid}`);
  }
  if (parts.length === 1) {
    const fallback = shared.filter(Boolean).join(" | ");
    if (fallback) return `Spreadsheet "${name}" (shared strings only):\n${fallback.slice(0, 20000)}`;
    return `Spreadsheet "${name}" stored locally. Could not read sheet cells.`;
  }
  return parts.join("\n\n").slice(0, 45000);
}

export function extractCsvText(raw: string, name: string): string {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim()).slice(0, 500);
  if (!lines.length) return `CSV "${name}" is empty.`;
  return `CSV "${name}" (${lines.length} rows shown):\n${lines.join("\n")}`.slice(0, 45000);
}
