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
  if (
    /\b(summar(y|ise|ize)?|overview|brief(?:ing)?|recap)\b/.test(t) ||
    /\bwhat(?:'s| is| does)\s+(this|it)\b/.test(t) ||
    /\bwhat\s+(does\s+)?this\s+include/.test(t) ||
    /\b(tell me|explain|describe)\s+(what\s+)?(this|the\s+file|the\s+attachment)\b/.test(t) ||
    (/\b(include[sd]?|consist|contain)\b/.test(t) && /\b(this|file|attachment|zip|doc)\b/.test(t)) ||
    /\bwhat is this\b/.test(t) ||
    /\bwalk (me )?through\b/.test(t) ||
    /\b(folder (tree|structure)|mermaid|diagram|visuali[sz]e)\b/.test(t) ||
    /\bexplain (the |this )?(project|repo|zip|file)\b/.test(t)
  ) {
    return true;
  }
  return false;
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
  "OVERRIDE: The user wants a SUMMARY of the ATTACHED FILE contents only. " +
  "Name each file and summarize what is inside it using quotes, headings, paths, and numbers from the text below. " +
  "Do NOT describe your role, job, instructions, the chat UI, system context, conversation structure, or a generic document-agent briefing. " +
  "If you cannot quote real phrases from the files below, say you could not read them.\n\n";

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
  if (/what is this|about|consist|overview|summar|tell me|explain/.test(blob)) {
    extra.push("summary", "experience", "education", "skills");
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

const FILE_GROUND =
  "Attached files follow. Infer what they actually are from the filename and text " +
  "(resume, notes, spreadsheet, banking CSV/XLSX, invoice, photo note, PDF, zip, or code). " +
  "Answer the user's question from this text only. Quote real names, dates, numbers, and filenames. " +
  "Read typos generously (e.g. 'specilised' means specialized/skills). " +
  "For spreadsheets, use the sheet names and tab-separated rows — totals, accounts, and amounts are in the grid. " +
  "When several files are attached, say which file each fact comes from. " +
  "Do not invent folders, tests, READMEs, jobs, meetings, people, or a next-step unless they appear below. " +
  "If the text is only a filename or a 'could not read' note, say you could not read the file. Do not invent a story. " +
  "If a line says you cannot see pixels, do not describe the image.\n\n";

const STUB =
  /no readable text|no text layer|cannot see the pixels|stored locally|looks binary so no text|could not be read|PDF engine failed/i;

export function thinAttachmentReply(files: NamedDoc[]): string | null {
  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) {
    return "This file is on the chat, but I could not read any text from it. If it is a scanned or image-only PDF, attach a Word / Google Doc export or a text-based PDF.";
  }
  const body = usable.map((f) => String(f.text || "")).join("\n");
  const letters = (body.match(/[A-Za-z]/g) || []).length;
  if (STUB.test(body) && letters < 240) {
    return "I could not read enough text from this PDF (it may be a scan or LinkedIn print-out). Attach a text-based résumé (Word or Print-to-PDF from Docs), then ask again.";
  }
  if (letters < 90) {
    return "I only got a few words from this file, not enough to summarize it honestly. Attach a text-based copy so I am not guessing.";
  }
  return null;
}

export function retrieveFileContext(files: NamedDoc[], query: string, budget: number): string {
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const heads = () =>
    usable.map((f) => `### ${f.name}\n${f.text.slice(0, Math.min(budget, 18000))}`).join("\n\n");
  if (wantsInterviewQuestions(query)) {
    return (
      "OVERRIDE: The user asked for INTERVIEW QUESTIONS about these files. " +
      "Write only numbered interview Q&A grounded in whatever these files actually are. " +
      "Do not force a project or folder template.\n\n" +
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

/** User-visible answer from files already in this tab when the LLM cannot run. */
export function offlineFileBrief(files: NamedDoc[], query: string, reason: "offline" | "no-model" = "offline"): string {
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const q = query.trim() || "What is in these files?";
  const blocks = usable.map((f) => {
    const raw = String(f.text || "").replace(/\r\n/g, "\n").trim();
    const clean = raw
      .split(/\s+/)
      .filter((w) => {
        if (w.length < 2) return false;
        if (/^https?:\/\//i.test(w)) return true;
        const alnum = (w.match(/[A-Za-z0-9]/g) || []).length;
        return alnum >= 2 && alnum / w.length >= 0.5;
      })
      .join(" ")
      .slice(0, 3500);
    if (!clean || clean.length < 24) {
      return `**${f.name}**\nNo readable text layer in this file. It may be a scanned PDF. Attach a .txt / .docx copy, or wait until the in-browser model finishes downloading.`;
    }
    return `**${f.name}**\n${clean}${raw.length > clean.length ? "…" : ""}`;
  });
  const lead =
    reason === "offline"
      ? "This tab is offline, so this is taken from the file already on this chat — not the full in-browser model."
      : "The in-browser model is not ready on this site yet (it must download ~700 MB once per browser origin). This is taken from the file already on this chat.";
  return `${lead}\n\nYou asked: ${q}\n\n` + blocks.join("\n\n");
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
    "You are a document agent on this device. Infer what was attached from the text, then answer the user's ask. " +
    "Stay accurate. Prefer attached-file excerpts, then recent chat, then retained memory. " +
    "Do not invent names, jobs, folders, or facts that are not in that context. " +
    "When the user asks for a summary of “this” or what something includes, and files are attached, summarize those files only — never summarize your role, these instructions, or the chat structure. " +
    "Interview questions: numbered Q&A from the files. Images: you cannot see pixels unless the note says otherwise. " +
    "Do not mention Moss, Ollama, WebGPU, or this product unless the user or files do. " +
    "Use retained memory silently. Never reprint it. Never output headings like User Memory Note, Open Tasks, or Retained Information unless the user asked to see the saved summary." +
    mem +
    (extra ? `\n\n${extra}` : "")
  );
}
