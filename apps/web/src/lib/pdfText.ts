/**
 * Real PDF text extraction with pdf.js.
 * Loaded from /pdf.js (application/javascript) — not .mjs — because production
 * nginx often serves .mjs as octet-stream and the browser then blocks the import.
 */

type PdfItem = { str?: string; transform?: number[]; hasEOL?: boolean };
type PdfPage = { getTextContent: () => Promise<{ items: PdfItem[] }> };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy?: () => Promise<void> };
type PdfLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: Record<string, unknown>) => { promise: Promise<PdfDoc> };
};

let libPromise: Promise<PdfLib> | null = null;

/** `base` lets the offline agent load "./pdf.js" next to itself. */
export function loadPdfLib(base = "/"): Promise<PdfLib> {
  if (!libPromise) {
    libPromise = (async () => {
      const lib = (await import(/* webpackIgnore: true */ `${base}pdf.js`)) as unknown as PdfLib;
      lib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.js`;
      return lib;
    })().catch((err) => {
      libPromise = null;
      throw err;
    });
  }
  return libPromise;
}

const LINE_TOLERANCE = 2.5;

function pageLines(items: PdfItem[]): string[] {
  const lines: string[] = [];
  let line = "";
  let lastY: number | null = null;
  for (const item of items) {
    const piece = typeof item.str === "string" ? item.str : "";
    const y = item.transform?.[5];
    if (typeof y === "number" && lastY !== null && Math.abs(y - lastY) > LINE_TOLERANCE) {
      if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
      line = "";
    }
    line += piece;
    if (item.hasEOL) {
      if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
      line = "";
    }
    if (typeof y === "number") lastY = y;
  }
  if (line.trim()) lines.push(line.replace(/\s+/g, " ").trim());
  return lines;
}

export type PdfExtract = { text: string; pages: number; scanned: boolean };

export async function extractPdfText(bytes: ArrayBuffer, base = "/"): Promise<PdfExtract> {
  const lib = await loadPdfLib(base);
  const doc = await lib.getDocument({
    data: new Uint8Array(bytes.slice(0)),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  const out: string[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const lines = pageLines(content.items);
      if (lines.length) {
        out.push(doc.numPages > 1 ? `[page ${n}]\n${lines.join("\n")}` : lines.join("\n"));
      }
    }
  } finally {
    await doc.destroy?.();
  }
  const text = out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return { text, pages: doc.numPages, scanned: letters < 40 };
}
