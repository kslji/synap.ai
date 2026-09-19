export type NamedDoc = { name: string; text: string };
export type Turn = { role: string; content: string };

/** In-browser Llama-3.2-1B is compiled at 4096 tokens. Stay well under that. */
export const BROWSER_DOC_BUDGET = 900;
export const BROWSER_TURN_BUDGET = 400;
export const BROWSER_MEMORY_BUDGET = 220;
/** Total characters sent to WebLLM (system + history + question). */
export const BROWSER_PROMPT_CHARS = 6000;

/** llama3.2:3b with num_ctx 8192 */
export const OLLAMA_DOC_BUDGET = 18000;
export const OLLAMA_TURN_BUDGET = 2400;
export const OLLAMA_MEMORY_BUDGET = 1200;
/**
 * llama3.2:1b / similar light tags use num_ctx ≈ 4096. Packing a huge file
 * leaves almost no room for the reply, so answers stop mid-word.
 */
export const OLLAMA_LIGHT_DOC_BUDGET = 2800;

export function isLightModelTag(model: string | null | undefined): boolean {
  return /1b|1\.5b|2b|in-browser/i.test(String(model || ""));
}

export function wantsSavedSummary(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  // Attachment / “what does this include” → file overview, not the Save-summary memory note.
  if (
    /\b(zip|file|project|code|repo|folder|readme|attachment|attached|include[sd]?|consist)\b/.test(t) &&
    !/\b(saved|chat|memory)\b/.test(t)
  ) {
    return false;
  }
  if (/\b(this|it)\b/.test(t) && /\b(summar|include|consist|about|contain)\b/.test(t) && !/\b(saved|chat|memory)\b/.test(t)) {
    return false;
  }
  return (
    /^(what(?:'s| is)|show(?: me)?|tell me|read)\s+(the |my |our )?(saved )?(chat )?summary\b/.test(t) ||
    /\b(saved summary|memory note|user memory note|retained memory|what did you (save|keep|summarize)|show (my )?memory)\b/.test(t) ||
    /^summary\??$/.test(t)
  );
}

/** User wants what’s inside the attached file(s), not chat memory or agent instructions. */
export function wantsFileOverview(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (wantsDiagram(q)) return false;
  if (wantsShortFact(q)) return false;
  if (
    /\b(summar(y|ise|ize)?|overview|brief(?:ing)?|recap)\b/.test(t) ||
    /\bwhat(?:'s| is| does| are)\s+(this|it|the main|the key)\b/.test(t) ||
    /\bmain things\b/.test(t) ||
    /\bwhat\s+(does\s+)?this\s+include/.test(t) ||
    /\b(tell me|explain|describe)\s+(what\s+)?(this|the\s+file|the\s+attachment)\b/.test(t) ||
    (/\b(include[sd]?|consist|contain)\b/.test(t) && /\b(this|file|attachment|zip|doc|resume)\b/.test(t)) ||
    /\bwhat is this\b/.test(t) ||
    /\bwhat (is|are) (in )?this (resume|file|doc|document|pdf)\b/.test(t) ||
    /\bwalk (me )?through\b/.test(t) ||
    /\bexplain (the |this )?(project|repo|zip|file|resume)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

/** Single-field lookup — answer in a few words, never dump the file. */
export function wantsShortFact(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (wantsInterviewQuestions(q) || wantsDiagram(q)) return false;
  return (
    /\b(how old|years?\s*old|date of birth|\bdob\b|\bage\b)\b/.test(t) ||
    /\b(e-?mail|phone|mobile|contact number|whatsapp|linkedin)\b/.test(t) ||
    /\bwhat(?:'s| is| was)\s+(his|her|their|the person'?s?|this (person|candidate)'?s?)\s+(name|age|email|phone|number|address|title|role|company|location|city)\b/.test(
      t,
    ) ||
    /\b(name|age|email|phone|number|address|title|role|company)\s+(of|for)\s+(the |this )?(person|candidate|author|user)?\b/.test(
      t,
    ) ||
    /\bwho is (this|the) (person|candidate|author)\b/.test(t)
  );
}

const CACHE_LEAD = "Based on previous cached data on this device.";

/** Short expert fact from attachment text when the LLM cannot run. */
export function extractiveFactAnswer(files: NamedDoc[], query: string): string | null {
  if (!wantsShortFact(query)) return null;
  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) return null;
  const blob = usable.map((f) => String(f.text || "")).join("\n");
  const q = query.trim().toLowerCase();
  const cite = usable[0]?.name ? ` [${usable[0].name}]` : "";

  const hit = (re: RegExp): string | null => {
    const m = blob.match(re);
    return m?.[1]?.trim() || null;
  };

  if (/\bage|how old|years?\s*old\b/.test(q)) {
    const age =
      hit(/\bage\s*[:\-–]?\s*(\d{1,3})\b/i) ||
      hit(/\b(\d{1,3})\s*(?:years?|yrs?)\s*old\b/i) ||
      hit(/\bage\s+(\d{1,3})\b/i);
    if (age) return `${CACHE_LEAD}\n\n${age}${cite}`;
    const dob = hit(
      /\b(?:dob|date of birth|born(?:\s+on)?)\s*[:\-–]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4})\b/i,
    );
    if (dob) return `${CACHE_LEAD}\n\nDate of birth in the file: ${dob}. Age as a number is not written.${cite}`;
    return `${CACHE_LEAD}\n\nAge is not written in this file.${cite}`;
  }

  if (/\be-?mail\b/.test(q)) {
    const email = hit(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
    return email ? `${CACHE_LEAD}\n\n${email}${cite}` : `${CACHE_LEAD}\n\nNo email found in this file.${cite}`;
  }

  if (/\b(phone|mobile|contact number|whatsapp)\b/.test(q)) {
    const labeled =
      hit(/\b(?:phone|mobile|tel|cell|whatsapp)\s*[:\-–]?\s*([+\d][\d\s().\-]{7,}\d)/i) ||
      hit(/(?:\+?\d{1,3}[\s\-.]?)?(?:\(?\d{2,5}\)?[\s\-.]?)?\d{3,5}[\s\-.]?\d{3,5}(?:[\s\-.]?\d{2,5})?/);
    return labeled
      ? `${CACHE_LEAD}\n\n${labeled}${cite}`
      : `${CACHE_LEAD}\n\nNo phone number found in this file.${cite}`;
  }

  if (/\blinkedin\b/.test(q)) {
    const url = hit(/\b((?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s]+)/i);
    return url ? `${CACHE_LEAD}\n\n${url}${cite}` : `${CACHE_LEAD}\n\nNo LinkedIn URL found in this file.${cite}`;
  }

  if (/\b(who is|name)\b/.test(q)) {
    const name =
      hit(/\b(?:name|candidate)\s*[:\-–]\s*([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,3})\b/) ||
      usable[0]?.name.replace(/\.(pdf|docx?|txt)$/i, "").replace(/[_-]+/g, " ");
    if (name && name.length > 2) return `${CACHE_LEAD}\n\n${name}${cite}`;
  }

  if (/\b(title|role|designation)\b/.test(q)) {
    const title =
      hit(/\b(?:title|role|designation|position)\s*[:\-–]\s*([^\n]{3,80})/i) ||
      hit(
        /\b((?:senior|junior|lead|staff|principal)?\s*(?:software|data|ml|ai|full[\s-]?stack|backend|frontend|devops)?\s*(?:engineer|developer|analyst|scientist|manager|architect)[^\n]{0,40})/i,
      );
    if (title) return `${CACHE_LEAD}\n\n${title.trim()}${cite}`;
  }

  if (/\b(company|employer|organization)\b/.test(q)) {
    const co = hit(/\b(?:company|employer|organization|at)\s*[:\-–]?\s*([A-Z][^\n,]{2,60})/);
    if (co) return `${CACHE_LEAD}\n\n${co.trim()}${cite}`;
  }

  if (/\b(location|city|address|based)\b/.test(q)) {
    const loc =
      hit(/\b(?:location|city|address|based in)\s*[:\-–]?\s*([^\n]{3,80})/i) ||
      hit(/\b([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+){0,3},\s*[A-Z]{2,})\b/);
    if (loc) return `${CACHE_LEAD}\n\n${loc.trim()}${cite}`;
  }

  return null;
}

/** User asked for a flowchart / architecture diagram (not a text dump). */
export function wantsDiagram(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  return (
    /\b(mermaid|flowchart|diagram|visuali[sz]e|visuali[sz]?ing|architecture\s+(diagram|map|chart)|draw\s+(a\s+)?(flow|diagram|chart)|show\s+(me\s+)?(a\s+)?(flow|diagram|chart))\b/.test(
      t,
    ) || /\bflowchart\s+(tb|td|lr|rl|bt)\b/.test(t)
  );
}

/** Collect folder/file paths from zip extract text (bullets or space-separated tree line). */
export function pathsFromFiles(files: NamedDoc[]): string[] {
  const blob = files.map((f) => String(f.text || "")).join("\n");
  const paths: string[] = [];
  const push = (raw: string) => {
    const norm = raw
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^[-*`]+/, "")
      .replace(/\/+$/, "");
    if (!norm || norm.length > 180) return;
    if (/^(https?:|mailto:|file tree|extracted zip|no plain-text)/i.test(norm)) return;
    if (!/[\\/]/.test(norm) && !/\.[A-Za-z0-9]{1,8}$/.test(norm)) {
      // bare folder name without slash still ok if it looks like a project root
      if (!/^[A-Za-z0-9._-]+$/.test(norm)) return;
    }
    if (!/[A-Za-z0-9._-]+/.test(norm)) return;
    paths.push(norm);
  };
  for (const line of blob.split(/\r?\n/)) {
    const t = line.trim().replace(/^\d+\.\s*/, "").replace(/^[-*]\s*/, "");
    if (!t) continue;
    if (/^file tree/i.test(t)) {
      const after = t.replace(/^file tree[^:]*:\s*/i, "");
      if (after && after !== t) {
        for (const part of after.split(/\s+/)) push(part);
      }
      continue;
    }
    if (/^(extracted zip|summarize from|folder questions|--- )/i.test(t)) continue;
    if (/[\\/]/.test(t) || t.endsWith("/")) push(t.replace(/\/+$/, ""));
  }
  return [...new Set(paths)];
}

/**
 * Build a Mermaid flowchart from zip file-tree lines so light models still show a diagram.
 */
export function architectureFlowFromFiles(files: NamedDoc[]): string | null {
  const paths = pathsFromFiles(files);
  if (paths.length < 2) return null;
  const roots = new Map<string, Set<string>>();
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    if (!parts.length) continue;
    const root = parts[0];
    const child = parts[1];
    if (!roots.has(root)) roots.set(root, new Set());
    if (child) roots.get(root)!.add(child);
  }
  const entries = [...roots.entries()].sort((a, b) => b[1].size - a[1].size);
  if (!entries.length) return null;
  const [root, kids] = entries[0];
  const id = (s: string) =>
    "N" +
    s
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 28);
  const lines = [`flowchart TB`, `  ${id(root)}["${root}"]`];
  const childList = [...kids].slice(0, 10);
  if (!childList.length) {
    for (const p of paths.slice(0, 8)) {
      const parts = p.split("/").filter(Boolean);
      if (parts.length < 2) continue;
      childList.push(parts[1]);
      if (childList.length >= 8) break;
    }
  }
  const seen = new Set<string>();
  for (const c of childList) {
    if (seen.has(c)) continue;
    seen.add(c);
    lines.push(`  ${id(c)}["${c}"]`);
    lines.push(`  ${id(root)} --> ${id(c)}`);
  }
  if (lines.length < 4) return null;
  return (
    `Architecture from the attached file tree:\n\n\`\`\`mermaid\n${lines.join("\n")}\n\`\`\``
  );
}

/** Interview Q&A from zip tree / file names when the LLM cannot run. */
export function extractiveInterviewQuestions(files: NamedDoc[]): string {
  const paths = pathsFromFiles(files);
  const names = files.map((f) => f.name).filter(Boolean);
  const root =
    paths.map((p) => p.split("/")[0]).find(Boolean) ||
    names[0]?.replace(/\.zip$/i, "") ||
    "this project";
  const kids = [
    ...new Set(
      paths
        .map((p) => p.split("/").filter(Boolean)[1])
        .filter((x): x is string => !!x),
    ),
  ].slice(0, 8);
  const qs: string[] = [];
  if (kids.length) {
    qs.push(
      `What does each top-level area in \`${root}\` do — especially ${kids
        .slice(0, 4)
        .map((k) => `\`${k}\``)
        .join(", ")} — and how do they connect?`,
    );
    qs.push(`Walk me through a request that starts in one of these folders and ends in another: ${kids.map((k) => `\`${k}\``).join(", ")}.`);
  } else {
    qs.push(`What is \`${root}\`, and what problem does this codebase solve?`);
  }
  if (kids.some((k) => /test|eval|contract/i.test(k))) {
    qs.push(`How would you test or evaluate a change here (look at folders like ${kids.filter((k) => /test|eval|contract/i.test(k)).map((k) => `\`${k}\``).join(", ") || "`tests`"})?`);
  }
  if (kids.some((k) => /result|trace|case/i.test(k))) {
    qs.push(`What belongs in results, traces, or cases, and how would you debug a failing run using those artifacts?`);
  }
  qs.push(`If you had one day to improve \`${root}\`, what would you change first and why?`);
  qs.push(`Which module would you open first in a code review, and what risks would you look for?`);
  const body = qs.map((q, i) => `${i + 1}. ${q}`).join("\n\n");
  return (
    `Interview questions grounded in the attached project (\`${root}\`), from the zip file tree` +
    (kids.length ? ` (folders: ${kids.map((k) => `\`${k}\``).join(", ")})` : "") +
    `:\n\n${body}`
  );
}

/** Light models often paraphrase the system prompt instead of the file — detect that. */
export function isMetaAgentNoise(text: string): boolean {
  const t = String(text || "").toLowerCase();
  return (
    /document agent/.test(t) ||
    /based on the provided text, the summary includes/.test(t) ||
    /system context/.test(t) ||
    /list of attached files/.test(t) ||
    /agent'?s? (job|role) (description|and responsibilities)/.test(t) ||
    /these instructions/.test(t) ||
    /conversation structure/.test(t) ||
    /folder listing/.test(t) && /agent/.test(t)
  );
}

/** Honest file summary without the LLM (used for 1B / when the model goes meta). */
export function extractiveFileOverview(files: NamedDoc[], maxPerFile = 2400): string {
  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) return "";
  const parts = usable.map((f) => {
    const raw = String(f.text || "").replace(/\r\n/g, "\n").trim();
    const body = clipAtBoundary(raw, maxPerFile);
    return `**${f.name}**\n${body}${raw.length > body.length ? "\n…" : ""}`;
  });
  return (
    `Here is what the attached file${usable.length > 1 ? "s contain" : " contains"} ` +
    `(taken from the file text on this chat — not from earlier messages or agent instructions):\n\n` +
    parts.join("\n\n")
  );
}

/** Prefer cutting on a newline / sentence so tables and words are not sliced mid-token. */
function clipAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const nl = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
  if (nl > max * 0.55) return slice.slice(0, nl).trimEnd();
  const sp = slice.lastIndexOf(" ");
  if (sp > max * 0.55) return slice.slice(0, sp).trimEnd();
  return slice.trimEnd();
}

const OVERVIEW_OVERRIDE =
  "OVERRIDE: Act as a human expert who just read the ATTACHED sources. " +
  "Give a short, useful overview in bullets with real headings, skills, paths, and numbers. " +
  "Cite with [filename]. Do NOT paste the whole file. Do NOT describe your role or the chat UI. " +
  "If you cannot quote real phrases from the files below, say you could not read them.\n\n";

const FILE_GROUND =
  "CONTEXT (attached sources) follows. You are a human-like document expert. " +
  "Read typos and messy wording generously — infer what the user meant (e.g. 'thie image' = this image) and answer that intent. " +
  "Decide intent, then answer like a colleague who studied this file — clear, direct, useful. " +
  "Cite with [filename]. Match length to the ask: one fact → one short line; overview → a few bullets; never dump the full document. " +
  "For images: you cannot see pixels; answer from the filename note and the user's intent only — never call an image a PDF résumé. " +
  "For spreadsheets, use the sheet grids. " +
  "When several files are attached, say which file each fact comes from. " +
  "Do not invent folders, tests, READMEs, jobs, meetings, people, or next steps unless they appear below. " +
  "If the text is only a filename or a 'could not read' note, say you could not read the file. " +
  "If a line says you cannot see pixels, do not describe the image as if you saw it.\n\n";

/**
 * Chunk on real line and paragraph boundaries so a section header stays with its
 * body. Flattening every newline used to cut "TECHNICAL SKILLS" away from the list.
 */
export function chunkText(text: string, size = 700, overlap = 90): string[] {
  const t = String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!t) return [];
  const lines = t.split("\n").map((l) => l.trim());
  const chunks: string[] = [];
  let buf = "";
  const flush = () => {
    if (!buf.trim()) return;
    chunks.push(buf.trim());
    const tail = buf.slice(-overlap);
    buf = overlap && tail.trim() ? `${tail.trim()}\n` : "";
  };
  for (const line of lines) {
    if (!line) continue;
    if (buf.length + line.length + 1 > size) flush();
    if (line.length > size) {
      for (let i = 0; i < line.length; i += size) {
        chunks.push(line.slice(i, i + size));
      }
      buf = "";
      continue;
    }
    buf += `${line}\n`;
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.slice(0, 60);
}

function editDistance1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) return editDistance1(b, a);
  let i = 0;
  let j = 0;
  let skips = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++skips > 1) return false;
    if (la === lb) {
      i++;
      j++;
    } else {
      j++;
    }
  }
  return true;
}

/** Expand common typos / near-synonyms so “specilised” still finds skills sections. */
function queryTerms(query: string): string[] {
  const base = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  const extra: string[] = [];
  const blob = query.toLowerCase();
  if (/speciali[sz]|expertise|focus|strong(est)? at|good at/.test(blob)) {
    extra.push("skills", "technical", "experience", "python", "backend", "engineer", "specialization");
  }
  if (/bank|ledger|transaction|balance|invoice|sheet|excel|xlsx|csv|financ/.test(blob)) {
    extra.push("amount", "debit", "credit", "balance", "account", "sheet", "total");
  }
  if (/what is this|about|consist|overview|summar|tell me|explain|image|picture|screenshot|photo/.test(blob)) {
    extra.push("summary", "experience", "education", "skills", "image", "screenshot");
  }
  return [...new Set([...base, ...extra])];
}

function scoreChunk(chunk: string, name: string, query: string, index: number): number {
  const q = query.toLowerCase();
  const body = `${name} ${chunk}`.toLowerCase();
  const bodyWords = body.split(/\W+/).filter((w) => w.length > 2);
  const words = queryTerms(query);
  let s = 0;
  if (index === 0) s += 12;
  if (index === 1) s += 6;
  if (/\b(about|summar|overview|what is this|this file|tell me|consist|explain)\b/.test(q)) {
    if (index === 0) s += 40;
    if (index === 1) s += 18;
  }
  for (const w of words) {
    if (name.toLowerCase().includes(w)) s += 10;
    if (body.includes(w)) s += 5;
    else if (w.length >= 4) {
      for (const bw of bodyWords) {
        if (bw.length < 4) continue;
        if (editDistance1(w, bw) || (w.length >= 5 && bw.startsWith(w.slice(0, 4)))) {
          s += 3;
          break;
        }
      }
    }
  }
  return s;
}

/** User asked to convert / export between file types (PDF, Word, Excel, etc.). */
export function wantsFileConvert(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (/\b(convert|conversion|export|download as|save as|turn into|turn to|make into|render as|print to)\b/.test(t)) {
    if (
      /\b(pdf|docx?|xlsx?|xls|csv|pptx?|word|excel|spreadsheet|slides?|powerpoint|doc)\b/.test(t)
    ) {
      return true;
    }
  }
  if (/\bpdf\b/.test(t) && /\b(docx?|word|xlsx?|excel|csv|pptx?|slides?)\b/.test(t)) return true;
  if (/\b(docx?|xlsx|xls|csv|pptx?|word|excel|spreadsheet|slides?)\b/.test(t) && /\bpdf\b/.test(t)) {
    return true;
  }
  return false;
}

/** @deprecated use wantsFileConvert */
export function wantsPdfExport(q: string): boolean {
  return wantsFileConvert(q);
}

export const FILE_CONVERT_UNSUPPORTED =
  "File conversion is not supported right now. Surf can read attached PDF, Word, Excel, and similar files for questions, but it does not convert between formats (for example PDF ↔ Word or Excel → PDF).";

export function wantsInterviewQuestions(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (/\binterview questions?\b/.test(t)) return true;
  if (/\bquestions?\b/.test(t) && /\binterview\b/.test(t)) return true;
  return /\b(prep(are)? me for (an )?interview|ask me (interview )?questions)\b/.test(t);
}

const STUB =
  /no readable text|no text layer|cannot see the pixels|stored locally|looks binary so no text|could not be read|PDF engine failed/i;

const IMAGE_STUB = /^Image\s+"/i;
const NO_VISION = /cannot see the pixels/i;

/** Fix common typos and rough phrasing so intent detectors still fire. */
export function normalizeUserAsk(raw: string): string {
  let t = String(raw || "").trim();
  if (!t) return t;
  const fixes: Array<[RegExp, string]> = [
    [/\bthie\b/gi, "this"],
    [/\bteh\b/gi, "the"],
    [/\badn\b/gi, "and"],
    [/\bwhta\b/gi, "what"],
    [/\bwht\b/gi, "what"],
    [/\bwaht\b/gi, "what"],
    [/\bimgae\b/gi, "image"],
    [/\bimg\b/gi, "image"],
    [/\b(pciture|pictuer|picure)\b/gi, "picture"],
    [/\bscrenshot\b/gi, "screenshot"],
    [/\bscreenshit\b/gi, "screenshot"],
    [/\bresumae?\b/gi, "resume"],
    [/\bcv\b/gi, "resume"],
    [/\binterveiw\b/gi, "interview"],
    [/\bquestons?\b/gi, "questions"],
    [/\bdiagramm?\b/gi, "diagram"],
    [/\bvisuali[sz]eing\b/gi, "visualizing"],
    [/\babot\b/gi, "about"],
    [/\babotu\b/gi, "about"],
    [/\bexplian\b/gi, "explain"],
    [/\bsummari[sz]e?\b/gi, "summarize"],
    [/\bsumary\b/gi, "summary"],
  ];
  for (const [re, to] of fixes) t = t.replace(re, to);
  // "what is about" / "tell about" → insert "this"
  t = t.replace(/\bwhat (is|are) about\b/gi, "what $1 this about");
  t = t.replace(/\btell(?: me)? about\b/gi, "tell me about this");
  return t.replace(/\s+/g, " ").trim();
}

function isImageFileName(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(String(name || ""));
}

function isImageAttachment(f: NamedDoc): boolean {
  if (isImageFileName(f.name)) return true;
  const t = String(f.text || "");
  // Only trust the Image "…" extract line — not PDF stubs that mention pixels.
  return IMAGE_STUB.test(t.trim()) && NO_VISION.test(t);
}

function guessFromFilename(name: string): string {
  const n = String(name || "").toLowerCase();
  const base = n.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  if (/drop\s*box|dropbox/.test(n)) {
    return "a Dropbox-related screenshot or export (cloud files / sharing UI)";
  }
  if (/linked\s*in|linkedin/.test(n)) return "a LinkedIn profile or feed screenshot";
  if (/whats?app|telegram|slack|discord/.test(n)) return "a messaging-app screenshot";
  if (/screenshot|screen.?shot|snip|capture|photo\s*on/.test(n)) {
    return "a screenshot of something on the device";
  }
  if (/invoice|receipt|bill/.test(n)) return "a photo of an invoice or receipt";
  if (/resume|cv|curriculum/.test(n)) return "a photo or scan of a résumé";
  if (/id|passport|license|aadhaar|pan\b/.test(n)) return "an ID or document photo";
  if (base.length > 2) return `something related to “${base}” (guessed only from the filename)`;
  return "an image whose contents I cannot see";
}

/** Honest expert reply for images (no vision) — never claim it is a PDF résumé. */
export function imageExpertReply(files: NamedDoc[], query: string): string {
  const imgs = files.filter((f) => isImageAttachment(f));
  const list = imgs.length ? imgs : files;
  const parts = list.map((f) => {
    const dim = String(f.text || "").match(/(\d+)\s*[×x]\s*(\d+)\s*px/i);
    const size = dim ? ` (${dim[1]}×${dim[2]}px)` : "";
    const guess = guessFromFilename(f.name);
    return `**[${f.name}]**${size} — most likely ${guess}.`;
  });
  const q = normalizeUserAsk(query).toLowerCase();
  const wantsAbout = /\b(about|what|describe|see|show|explain|tell)\b/.test(q) || !q;
  return (
    (wantsAbout
      ? "I can’t see the pixels in this image on this device (no vision model) — I’m answering as an expert from the **filename** and your question only.\n\n"
      : "I can’t see the image pixels. From the filename and your question:\n\n") +
    parts.join("\n\n") +
    "\n\nIf you need what’s *inside* the picture (text, charts, faces), paste that text here or attach a PDF / Word export with a text layer."
  );
}

export function thinAttachmentReply(files: NamedDoc[], query = ""): string | null {
  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) {
    return "This file is on the chat, but I could not read any text from it. If it is an image, I cannot see pixels — try a clearer filename or paste the text you care about. If it is a scanned PDF, attach a text-based PDF or Word export.";
  }

  if (usable.every((f) => isImageAttachment(f))) {
    return imageExpertReply(usable, query);
  }

  // Mixed: answer images separately only when every non-empty file is an image stub — else continue.
  const body = usable.map((f) => String(f.text || "")).join("\n");
  const letters = (body.match(/[A-Za-z]/g) || []).length;
  const pdfLike = usable.some((f) => /\.pdf$/i.test(f.name) || /PDF|no text layer|scanned/i.test(f.text || ""));

  // Don't use image-pixel stubs as PDF résumé copy when a real image is mixed in.
  const onlyImageNoise = usable.every((f) => isImageAttachment(f) || !String(f.text || "").trim());
  if (onlyImageNoise) return imageExpertReply(usable.filter((f) => isImageAttachment(f)), query);

  if (STUB.test(body) && letters < 240 && !usable.some((f) => isImageAttachment(f))) {
    if (pdfLike) {
      return "I could not read enough text from this PDF (it may be a scan or image-only export). Attach a text-based PDF, Word, or Docs print-to-PDF, then ask again.";
    }
    return "I could not read enough usable text from this file. Attach a text-based copy (PDF with a text layer, Word, or plain text), or paste the part you care about.";
  }
  if (letters < 90 && !usable.some((f) => isImageAttachment(f))) {
    return "I only got a few words from this file, not enough to answer honestly. Attach a text-based copy or paste the relevant text.";
  }
  return null;
}

export function retrieveFileContext(files: NamedDoc[], query: string, budget: number): string {
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const heads = () =>
    usable.map((f) => `### ${f.name}\n${f.text.slice(0, Math.min(budget, 18000))}`).join("\n\n");
  if (wantsShortFact(query)) {
    const slice = Math.min(budget, 2200);
    return (
      "OVERRIDE: ONE short fact only (age, email, phone, name, title…). " +
      "Reply like a human expert in one short line. Cite [filename]. Do not paste the file. " +
      "If missing, say it is not in the file.\n\n" +
      heads().slice(0, slice)
    );
  }
  if (wantsInterviewQuestions(query)) {
    return (
      "OVERRIDE: INTERVIEW QUESTIONS as a hiring expert who read these files. " +
      "Write only numbered interview Q&A grounded in the files. Number 1, 2, 3 in order. " +
      "Do not force a project template.\n\n" +
      heads().slice(0, budget)
    );
  }
  if (wantsDiagram(query)) {
    return (
      "OVERRIDE: ARCHITECTURE / FLOW DIAGRAM as an expert on this codebase. " +
      "Short intro, then mermaid flowchart TB with real folder or module names. " +
      "Do not dump the raw file tree as the whole answer.\n\n" +
      heads().slice(0, budget)
    );
  }
  if (wantsFileOverview(query)) {
    return OVERVIEW_OVERRIDE + heads().slice(0, budget);
  }
  const ranked: Array<{ name: string; text: string; s: number; i: number }> = [];
  for (const f of usable) {
    chunkText(f.text).forEach((ch, i) => {
      ranked.push({ name: f.name, text: ch, s: scoreChunk(ch, f.name, query, i), i });
    });
  }
  ranked.sort((a, b) => b.s - a.s || a.i - b.i);
  const parts: string[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const row of ranked) {
    const key = `${row.name}:${row.i}`;
    if (seen.has(key)) continue;
    const block = `### ${row.name}\n${row.text}`;
    if (used + block.length > budget) continue;
    seen.add(key);
    parts.push(block);
    used += block.length;
    if (parts.length >= 12) break;
  }
  if (!parts.length) {
    const head = usable
      .map((f) => `### ${f.name}\n${f.text.slice(0, Math.floor(budget / usable.length))}`)
      .join("\n\n");
    return head.slice(0, budget);
  }
  return FILE_GROUND + parts.join("\n\n");
}

/** Fallback when WebLLM cannot run — expert-style, never dump the whole file. */
export function offlineFileBrief(files: NamedDoc[], query: string, reason: "offline" | "no-model" = "offline"): string {
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const q = query.trim() || "What is in these files?";

  const fact = extractiveFactAnswer(usable, q);
  if (fact) return fact;

  if (wantsDiagram(q)) {
    const diagram = architectureFlowFromFiles(usable);
    if (diagram) return `${CACHE_LEAD}\n\n${diagram}`;
  }
  if (wantsInterviewQuestions(q)) {
    return `${CACHE_LEAD}\n\n${extractiveInterviewQuestions(usable)}`;
  }
  if (wantsFileOverview(q)) {
    const overview = extractiveFileOverview(usable, 900);
    if (overview) {
      const body = overview.replace(/^Here is what the attached[\s\S]*?:\n\n/i, "").trim();
      return `${CACHE_LEAD}\n\n${body.slice(0, 1200)}${body.length > 1200 ? "\n…" : ""}`;
    }
  }

  const ranked: string[] = [];
  for (const f of usable) {
    const chunks = chunkText(String(f.text || ""));
    const scored = chunks
      .map((ch, i) => ({ ch, s: scoreChunk(ch, f.name, q, i) }))
      .sort((a, b) => b.s - a.s);
    const best = scored[0]?.ch?.trim();
    if (best) ranked.push(`From [${f.name}]: ${best.slice(0, 420)}`);
  }
  if (ranked.length) {
    return `${CACHE_LEAD}\n\n${ranked.join("\n\n")}`;
  }

  void reason;
  return `${CACHE_LEAD}\n\nI could not find a clear answer in the attached file for: ${q}`;
}

export function stripStafferLabels(text: string): string {
  const label =
    "hook|map|overview|key components|useful extras|next move|specific references|" +
    "what it is|real folders(?:\\/quotes)?|what they might miss|one thing to do next";
  const banned = new RegExp(`^(#{1,6}\\s*)?(\\*\\*)?(${label})(\\*\\*)?\\s*:?\\s*$`, "i");
  const lead = new RegExp(`^(\\*\\*)?(${label})(\\*\\*)?\\s*:\\s*`, "i");
  const bold = new RegExp(`\\*\\*(${label})\\*\\*\\s*:?\\s*`, "gi");
  return String(text || "")
    .split("\n")
    .flatMap((line) => {
      const t = line.trim();
      if (banned.test(t)) return [];
      let next = line.replace(/\s+overview\s*$/i, "");
      next = next.replace(bold, "");
      next = next.replace(lead, "");
      return [next];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isModelNoise(text: string): boolean {
  return /prompt tokens exceed|context window size|sliding_window_size|string_too_long/i.test(
    String(text || ""),
  );
}

export function trimTurns(messages: Turn[], budget: number): Turn[] {
  const out: Turn[] = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const content = String(m.content || "").slice(0, 700);
    if (!content.trim() || isModelNoise(content)) continue;
    if (used + content.length > budget) break;
    out.unshift({ role: m.role, content });
    used += content.length;
  }
  return out;
}

export function fitBrowserPrompt(
  system: string,
  turns: Turn[],
  question: string,
  maxChars = BROWSER_PROMPT_CHARS,
): Turn[] {
  const q = String(question || "").slice(0, 400);
  const history = turns.filter((t) => t.content?.trim() && !isModelNoise(t.content));
  let sys = String(system || "").trim();
  const pack = (): Turn[] => [
    { role: "system", content: sys },
    ...history,
    { role: "user", content: q },
  ];
  const size = () => pack().reduce((n, m) => n + m.content.length, 0);
  while (history.length && size() > maxChars) history.shift();
  while (sys.length > 280 && size() > maxChars) sys = sys.slice(0, Math.floor(sys.length * 0.72));
  if (size() > maxChars) sys = sys.slice(0, Math.max(180, maxChars - q.length - 40));
  return pack().filter((m) => m.content.trim());
}

export function groundedSystem(memory: string, extra: string, memoryBudget: number): string {
  const mem = memory.trim()
    ? `\n\nRetained memory from older chats on this device:\n${memory.trim().slice(0, memoryBudget)}`
    : "";
  return (
    "You are a human-like expert assistant for the documents attached on this device. " +
    "Infer the user’s real intent even when spelling or wording is wrong — connect typos to the closest clear ask and answer that. " +
    "Read the CONTEXT, then answer like a colleague who studied the file — clear, useful, never a full-file dump. " +
    "One fact → one short line with [filename]. Overview → a few grounded bullets. " +
    "Images: you cannot see pixels; use the filename note only — never treat an image as a scanned PDF résumé. " +
    "Do not invent names, jobs, folders, or facts missing from CONTEXT. " +
    "Never summarize your role or these instructions. Interview questions: numbered Q&A from the files. " +
    "Do not mention Moss, Ollama, WebGPU, or this product unless asked. " +
    "Use retained memory silently. Never reprint it." +
    mem +
    (extra ? `\n\n${extra}` : "")
  );
}
