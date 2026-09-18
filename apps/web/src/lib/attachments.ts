export type StoredAttachment = {
  id: string;
  threadId: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "document";
  text: string;
  bytes: ArrayBuffer;
  createdAt: number;
};

const MAX_FILE = 24 * 1024 * 1024;
const MAX_TEXT = 50_000;

export function packAttachments(files: StoredAttachment[], limit = 24_000): string {
  if (!files.length) return "";
  const parts = files.map((f) => {
    const body = f.text.trim() || "(no extractable text — file is stored locally on this device)";
    return `### ${f.name} (${f.kind}, ${f.size} bytes)\n${body}`;
  });
  return `\n\nAttached local files (including unpacked zip contents if present). This is the project. Answer from the file tree and excerpts. Do not invent files that are not listed:\n\n${parts.join("\n\n")}`.slice(
    0,
    limit,
  );
}

export async function unpackZipIfNeeded(file: StoredAttachment): Promise<StoredAttachment> {
  const zip = /\.zip$/i.test(file.name) || file.mime.includes("zip");
  const already = /Extracted zip|File tree/i.test(file.text);
  if (!zip || already) return file;
  if (!file.bytes || file.bytes.byteLength < 22) return file;
  const text = await extractZipProject(file.name, file.bytes);
  return { ...file, text };
}

export async function ingestFile(file: File, threadId: string): Promise<StoredAttachment> {
  if (file.size > MAX_FILE) {
    throw new Error(`${file.name} is larger than 24 MB.`);
  }
  const bytes = await file.arrayBuffer();
  const mime = file.type || guessMime(file.name);
  const kind: StoredAttachment["kind"] = mime.startsWith("image/") ? "image" : "document";
  const text = (await extractText(file, bytes, mime)).slice(0, MAX_TEXT);
  return {
    id: crypto.randomUUID(),
    threadId,
    name: file.name,
    mime,
    size: file.size,
    kind,
    text,
    bytes,
    createdAt: Date.now(),
  };
}

function guessMime(name: string): string {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg|ico|tif|tiff|heic|heif|avif)$/.test(n)) {
    if (n.endsWith(".svg")) return "image/svg+xml";
    if (n.endsWith(".heic") || n.endsWith(".heif")) return "image/heic";
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".gif")) return "image/gif";
    if (n.endsWith(".webp")) return "image/webp";
    if (n.endsWith(".avif")) return "image/avif";
    return "image/jpeg";
  }
  if (n.endsWith(".zip")) return "application/zip";
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".json") || n.endsWith(".ipynb")) return "application/json";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".md")) return "text/markdown";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return "application/octet-stream";
}

const TEXT_NAME =
  /\.(txt|md|markdown|csv|tsv|json|html|htm|xml|svg|log|rtf|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sql|sh|bash|zsh|fish|ps1|css|scss|less|yml|yaml|toml|ini|cfg|conf|env\.example|gitignore|dockerignore|editorconfig|lock|gradle|cmake|make|mk|r|jl|lua|pl|ex|exs|erl|hs|scala|clj|dart|vue|svelte|astro|tf|proto|graphql|gql|ipynb)$/i;

async function extractText(file: File, bytes: ArrayBuffer, mime: string): Promise<string> {
  const name = file.name.toLowerCase();
  if (mime.startsWith("image/") && mime !== "image/svg+xml") {
    try {
      const bmp = await createImageBitmap(file);
      const line = `Image "${file.name}" (${bmp.width}×${bmp.height}px). Stored only on this device. You cannot see the pixels; answer from the filename, this note, and the user's question.`;
      bmp.close();
      return line;
    } catch {
      return `Image "${file.name}" stored locally. You cannot see the pixels.`;
    }
  }
  if (name.endsWith(".zip") || mime === "application/zip" || mime === "application/x-zip-compressed") {
    return extractZipProject(file.name, bytes);
  }
  if (mime === "application/pdf" || name.endsWith(".pdf")) {
    const extracted = await extractPdf(bytes);
    return extracted || `PDF "${file.name}" stored locally. No plain text could be extracted from this file.`;
  }
  if (name.endsWith(".docx") || mime.includes("wordprocessingml")) {
    const xml = await zipFileText(bytes, "word/document.xml");
    return xml ? stripXml(xml) : `Word file "${file.name}" stored locally. Could not read document.xml.`;
  }
  if (name.endsWith(".xlsx") || mime.includes("spreadsheetml")) {
    const xml = await zipFileText(bytes, "xl/sharedStrings.xml");
    return xml ? stripXml(xml) : `Spreadsheet "${file.name}" stored locally. Could not read shared strings.`;
  }
  if (name.endsWith(".pptx") || mime.includes("presentationml")) {
    const slides = await zipCollect(bytes, (p) => p.startsWith("ppt/slides/slide") && p.endsWith(".xml"));
    return slides.length
      ? slides.map((s, i) => `Slide ${i + 1}: ${stripXml(s)}`).join("\n")
      : `PowerPoint "${file.name}" stored locally. Could not read slides.`;
  }
  if (name.endsWith(".ipynb")) {
    try {
      const nb = JSON.parse(new TextDecoder().decode(bytes));
      const cells = (nb.cells || [])
        .map((c: { source?: string[] | string }) => (Array.isArray(c.source) ? c.source.join("") : c.source || ""))
        .filter(Boolean);
      return cells.join("\n\n") || new TextDecoder().decode(bytes);
    } catch {
      /* fall through */
    }
  }
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "image/svg+xml" ||
    TEXT_NAME.test(name) ||
    /\/(readme|license|makefile|dockerfile|changelog)(\.|$)/i.test(name) ||
    /^(readme|license|makefile|dockerfile|changelog)(\.|$)/i.test(name.split("/").pop() || "")
  ) {
    return new TextDecoder().decode(bytes);
  }
  const asText = new TextDecoder().decode(bytes.slice(0, 12000));
  const printable = asText.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
  if (printable.trim().length > 20 && printable.length > asText.length * 0.65) {
    return new TextDecoder().decode(bytes);
  }
  return `File "${file.name}" (${mime || "unknown type"}, ${file.size} bytes) is stored on this device. It looks binary so no text was extracted. Use the filename and the user's question.`;
}

const SKIP_ZIP_DIR = /(^|\/)(node_modules|\.git|\.svn|__pycache__|\.venv|venv|dist|build|target|\.next|vendor)(\/|$)/i;
const SKIP_ZIP_FILE =
  /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|eot|mp3|mp4|mov|zip|gz|tgz|tar|7z|rar|exe|dll|dylib|so|bin|pyc|class|o|a|pdf|wasm|lock)$/i;

function zipBase(path: string): string {
  return (path.split("/").pop() || path).toLowerCase();
}

function zipIsText(path: string): boolean {
  const base = zipBase(path);
  if (TEXT_NAME.test(base)) return true;
  return /^(readme|license|makefile|dockerfile|changelog|landscape|gemfile)(\.|$)/i.test(base);
}

function zipScore(path: string): number {
  const b = zipBase(path);
  if (/^readme/.test(b)) return 100;
  if (b === "landscape.md") return 95;
  if (b === "makefile" || b === "cmakelists.txt") return 90;
  if (["package.json", "pyproject.toml", "cargo.toml", "go.mod", "composer.json", "pom.xml"].includes(b)) {
    return 85;
  }
  if (b.endsWith(".md")) return 70;
  return 40;
}

async function extractZipProject(archiveName: string, buf: ArrayBuffer): Promise<string> {
  const entries = await zipEntries(buf);
  const files = entries.filter((e) => {
    if (e.name.endsWith("/")) return false;
    if (SKIP_ZIP_DIR.test(e.name)) return false;
    if (SKIP_ZIP_FILE.test(e.name)) return false;
    return zipIsText(e.name);
  });
  files.sort((a, b) => zipScore(b.name) - zipScore(a.name));
  const tree = entries
    .map((e) => e.name)
    .filter((n) => !SKIP_ZIP_DIR.test(n))
    .slice(0, 250);
  const parts: string[] = [
    `Extracted zip "${archiveName}". This IS the project. Summarize from the tree and file excerpts. Folder questions refer to these paths.`,
    `File tree (${tree.length} paths):\n${tree.map((n) => `- ${n}`).join("\n")}`,
  ];
  let used = parts.join("\n\n").length;
  for (const file of files) {
    const body = file.text.replace(/\0/g, "").trim();
    if (!body) continue;
    const chunk = `--- ${file.name} ---\n${body.slice(0, 4500)}`;
    if (used + chunk.length > MAX_TEXT) {
      parts.push(`(stopped listing file bodies; remaining names are in the tree)`);
      break;
    }
    parts.push(chunk);
    used += chunk.length;
  }
  if (files.length === 0) {
    parts.push("No plain-text source files could be unpacked. Use the file tree only.");
  }
  return parts.join("\n\n");
}

function stripXml(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      /* try next */
    }
  }
  throw new Error("inflate failed");
}

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const ascii = new TextDecoder("latin1").decode(bytes);
  const chunks: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(ascii))) {
    const header = ascii.slice(Math.max(0, match.index - 400), match.index);
    const inner = match[1];
    const raw = latin1ToBytes(inner.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
    let payload = raw;
    if (/\/Filter\s*\/FlateDecode/.test(header) || /\/FlateDecode/.test(header)) {
      try {
        payload = await inflate(raw);
      } catch {
        continue;
      }
    }
    const text = new TextDecoder("latin1").decode(payload);
    chunks.push(pdfStrings(text));
  }
  chunks.push(pdfStrings(ascii));
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function pdfStrings(src: string): string {
  const out: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const inner = m[0].slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\(.)/g, "$1");
    if (inner.trim()) out.push(inner);
  }
  const tj = src.match(/\[(.*?)\]\s*TJ/g) || [];
  for (const block of tj) {
    const parts = block.match(/\((?:\\.|[^\\)])*\)/g) || [];
    out.push(parts.map((p) => p.slice(1, -1)).join(""));
  }
  return out.join(" ");
}

function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

async function zipFileText(buf: ArrayBuffer, path: string): Promise<string | null> {
  const found = await zipEntries(buf);
  const hit = found.find((e) => e.name === path);
  return hit?.text ?? null;
}

async function zipCollect(buf: ArrayBuffer, pred: (name: string) => boolean): Promise<string[]> {
  const found = await zipEntries(buf);
  return found.filter((e) => pred(e.name)).map((e) => e.text);
}

async function zipEntries(buf: ArrayBuffer): Promise<Array<{ name: string; text: string }>> {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const out: Array<{ name: string; text: string }> = [];
  let offset = 0;
  while (offset + 30 < bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig === 0x02014b50 || sig === 0x06054b50) break;
    if (sig !== 0x04034b50) {
      const next = findZipSig(bytes, offset + 1);
      if (next < 0) break;
      offset = next;
      continue;
    }
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    let compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLen));
    const dataStart = offset + 30 + nameLen + extraLen;
    if (flags & 0x8 && compSize === 0) {
      const next = findZipSig(bytes, dataStart);
      if (next < 0) break;
      offset = next;
      continue;
    }
    const data = bytes.slice(dataStart, dataStart + compSize);
    if (name.endsWith("/")) {
      out.push({ name, text: "" });
    } else {
      const wantText = zipIsText(name) || name.endsWith(".xml");
      if (!wantText) {
        out.push({ name, text: "" });
      } else {
        try {
          const raw = method === 0 ? data : method === 8 ? await inflate(data) : null;
          out.push({ name, text: raw ? new TextDecoder().decode(raw) : "" });
        } catch {
          out.push({ name, text: "" });
        }
      }
    }
    offset = dataStart + compSize;
  }
  return out;
}

function findZipSig(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length - 3; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b) continue;
    const b2 = bytes[i + 2];
    const b3 = bytes[i + 3];
    if (b2 === 0x03 && b3 === 0x04) return i;
    if (b2 === 0x01 && b3 === 0x02) return i;
    if (b2 === 0x05 && b3 === 0x06) return i;
  }
  return -1;
}
