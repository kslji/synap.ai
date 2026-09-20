/**
 * Shared chat Markdown helpers — used by MarkdownBody (React) and mirrored in local-agent.html.
 * Never mutates stored message text; only prepares a display string / parse tree.
 */

export type MdFence = { kind: "code"; lang: string; body: string; closed: boolean };
export type MdProse = { kind: "prose"; body: string };
export type MdChunk = MdFence | MdProse;

export type HighlightToken = { type: "plain" | "key" | "str" | "num" | "kw" | "cmt" | "punct"; text: string };

/** Close an odd number of fences for streaming display only. */
export function prepareForRender(text: string, streaming = false): string {
  let s = String(text || "").replace(/\r\n/g, "\n");
  // Soft-wrap bare JSON objects/arrays that models dump without fences.
  if (!streaming) s = autofenceJson(s);
  const ticks = (s.match(/```/g) || []).length;
  if (ticks % 2 === 1) s += "\n```";
  return s;
}

function autofenceJson(src: string): string {
  const trimmed = src.trim();
  if (/^```/.test(trimmed)) return src;
  if (!/^[\[{]/.test(trimmed) || !/[\]}]$/.test(trimmed)) return src;
  try {
    const parsed = JSON.parse(trimmed);
    return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
  } catch {
    return src;
  }
}

/** Split into prose / fenced code chunks (after prepareForRender). */
export function splitMarkdownChunks(src: string): MdChunk[] {
  const text = String(src || "");
  const chunks: MdChunk[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("```", i);
    if (open === -1) {
      const rest = text.slice(i);
      if (rest) chunks.push({ kind: "prose", body: rest });
      break;
    }
    if (open > i) chunks.push({ kind: "prose", body: text.slice(i, open) });
    const after = text.slice(open + 3);
    const langMatch = /^([^\n`]*)\n?/.exec(after);
    const lang = (langMatch?.[1] || "").trim();
    const bodyStart = open + 3 + (langMatch?.[0].length || 0);
    const close = text.indexOf("```", bodyStart);
    if (close === -1) {
      chunks.push({ kind: "code", lang, body: text.slice(bodyStart).replace(/\n$/, ""), closed: false });
      break;
    }
    chunks.push({
      kind: "code",
      lang,
      body: text.slice(bodyStart, close).replace(/\n$/, ""),
      closed: true,
    });
    i = close + 3;
  }
  return chunks;
}

export function looksLikeJsonBlock(lang: string, body: string): boolean {
  const l = (lang || "").toLowerCase();
  if (l === "json" || l === "jsonc") return true;
  const t = body.trim();
  if (!/^[\[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

export function formatCodeBody(lang: string, body: string): { lang: string; body: string } {
  if (looksLikeJsonBlock(lang, body)) {
    try {
      return { lang: "json", body: JSON.stringify(JSON.parse(body.trim()), null, 2) };
    } catch {
      /* keep */
    }
  }
  return { lang: (lang || "").trim(), body };
}

const KEYWORDS: Record<string, RegExp> = {
  js: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|typeof|null|undefined|true|false)\b/g,
  ts: /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|typeof|null|undefined|true|false|type|interface|extends|implements)\b/g,
  py: /\b(def|class|return|if|elif|else|for|while|import|from|as|with|try|except|finally|True|False|None|async|await|yield|lambda)\b/g,
  bash: /\b(if|then|else|fi|for|do|done|while|case|esac|function|export|echo|cd|ls|npm|pip|curl)\b/g,
  sql: /\b(SELECT|FROM|WHERE|AND|OR|JOIN|LEFT|RIGHT|INNER|INSERT|UPDATE|DELETE|CREATE|TABLE|AS|ON|NULL|NOT|IN|ORDER|BY|GROUP|LIMIT)\b/gi,
};

function langKey(lang: string): string {
  const l = (lang || "").toLowerCase();
  if (["js", "javascript", "jsx", "mjs", "cjs"].includes(l)) return "js";
  if (["ts", "typescript", "tsx"].includes(l)) return "ts";
  if (["py", "python"].includes(l)) return "py";
  if (["sh", "bash", "zsh", "shell"].includes(l)) return "bash";
  if (["sql"].includes(l)) return "sql";
  if (["json", "jsonc"].includes(l)) return "json";
  return l;
}

/** Lightweight token highlighter (no external deps). */
export function highlightTokens(code: string, lang: string): HighlightToken[] {
  const key = langKey(lang);
  if (key === "json") return highlightJson(code);
  const kw = KEYWORDS[key];
  if (!kw) return [{ type: "plain", text: code }];

  const tokens: HighlightToken[] = [];
  const re = new RegExp(
    `(#.*$|//.*$|/\\*[\\s\\S]*?\\*/|"([^"\\\\]|\\\\.)*"|'([^'\\\\]|\\\\.)*'|\`([^\`\\\\]|\\\\.)*\`|\\b\\d+(?:\\.\\d+)?\\b|${kw.source})`,
    kw.flags.includes("i") ? "gim" : "gm",
  );
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) tokens.push({ type: "plain", text: code.slice(last, m.index) });
    const t = m[0];
    let type: HighlightToken["type"] = "plain";
    if (t.startsWith("#") || t.startsWith("//") || t.startsWith("/*")) type = "cmt";
    else if (t.startsWith('"') || t.startsWith("'") || t.startsWith("`")) type = "str";
    else if (/^\d/.test(t)) type = "num";
    else type = "kw";
    tokens.push({ type, text: t });
    last = m.index + t.length;
  }
  if (last < code.length) tokens.push({ type: "plain", text: code.slice(last) });
  return tokens.length ? tokens : [{ type: "plain", text: code }];
}

function highlightJson(code: string): HighlightToken[] {
  const tokens: HighlightToken[] = [];
  const re =
    /("(?:\\.|[^"\\])*")\s*(:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) tokens.push({ type: "plain", text: code.slice(last, m.index) });
    if (m[1] != null) {
      tokens.push({ type: m[2] ? "key" : "str", text: m[1] });
      if (m[2]) tokens.push({ type: "punct", text: ":" });
    } else if (m[3]) tokens.push({ type: "kw", text: m[3] });
    else if (/^-?\d/.test(m[0])) tokens.push({ type: "num", text: m[0] });
    else tokens.push({ type: "punct", text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < code.length) tokens.push({ type: "plain", text: code.slice(last) });
  return tokens.length ? tokens : [{ type: "plain", text: code }];
}

export type TableBlock = { headers: string[]; rows: string[][] };

/** Parse a GFM table block starting at lines[start]. Returns null if not a table. */
export function parseTableAt(lines: string[], start: number): { table: TableBlock; end: number } | null {
  const headerLine = lines[start];
  if (!/^\|.+\|$/.test(headerLine.trim()) && !/^\|?.+\|.+\|?$/.test(headerLine.trim())) return null;
  const sep = lines[start + 1];
  if (!sep || !/^\s*\|?[\s:|-]+\|[\s:|-]*\|?\s*$/.test(sep)) return null;
  const split = (line: string) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const headers = split(headerLine);
  if (headers.length < 2) return null;
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
    rows.push(split(lines[i]));
    i++;
  }
  return { table: { headers, rows }, end: i };
}

/** Detect [filename.ext] style file citations (not markdown links). */
export function isFileRef(token: string): boolean {
  return /^\[[^\]\n]{1,120}\.[a-z0-9]{1,12}\]$/i.test(token);
}

export function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
