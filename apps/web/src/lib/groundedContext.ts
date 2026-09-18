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

export function wantsSavedSummary(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (/\b(zip|file|project|code|repo|folder|readme)\b/.test(t) && !/\b(saved|chat|memory)\b/.test(t)) {
    return false;
  }
  return (
    /^(what(?:'s| is)|show(?: me)?|tell me|read)\s+(the |my |our )?(saved )?(chat )?summary\b/.test(t) ||
    /\b(saved summary|memory note|user memory note|retained memory|what did you (save|keep|summarize)|show (my )?memory)\b/.test(t) ||
    /^summary\??$/.test(t)
  );
}

export function chunkText(text: string, size = 480, overlap = 70): string[] {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const chunks: string[] = [];
  const step = Math.max(80, size - overlap);
  for (let i = 0; i < t.length; i += step) {
    chunks.push(t.slice(i, i + size));
    if (i + size >= t.length) break;
  }
  return chunks.slice(0, 60);
}

function scoreChunk(chunk: string, name: string, query: string, index: number): number {
  const q = query.toLowerCase();
  const body = `${name} ${chunk}`.toLowerCase();
  const words = q.split(/\W+/).filter((w) => w.length > 2);
  let s = 0;
  if (index === 0) s += 12;
  if (index === 1) s += 6;
  if (/\b(about|summar|overview|what is this|this file|tell me)\b/.test(q)) {
    if (index === 0) s += 40;
    if (index === 1) s += 18;
  }
  for (const w of words) {
    if (name.toLowerCase().includes(w)) s += 10;
    if (body.includes(w)) s += 5;
  }
  return s;
}

export function wantsPdfExport(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (/\bpdf\b/.test(t) && /\b(convert|export|download|save|make|turn|render|print)\b/.test(t)) return true;
  if (/\b(docx?|xlsx|xls|csv|pptx?|word|excel|spreadsheet|slides?)\b/.test(t) && /\bpdf\b/.test(t)) {
    return true;
  }
  return false;
}

export function wantsInterviewQuestions(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (/\binterview questions?\b/.test(t)) return true;
  if (/\bquestions?\b/.test(t) && /\binterview\b/.test(t)) return true;
  return /\b(prep(are)? me for (an )?interview|ask me (interview )?questions)\b/.test(t);
}

export function retrieveFileContext(files: NamedDoc[], query: string, budget: number): string {
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const heads = () =>
    usable.map((f) => `### ${f.name}\n${f.text.slice(0, Math.min(budget, 18000))}`).join("\n\n");
  if (wantsInterviewQuestions(query)) {
    return (
      "OVERRIDE: The user asked for INTERVIEW QUESTIONS about these files. " +
      "Write only numbered interview Q&A. Do not use template section titles. " +
      "Output: a one-line title, then 8–12 numbered interview questions. " +
      "Each question must be answerable only from the tree below (real folders, files, tests, configs, quotes). " +
      "Under each question put 1–2 short bullets of what a strong answer would mention from these files.\n\n" +
      heads().slice(0, budget)
    );
  }
  const wantsOverview =
    /\b(summar(y|ise|ize)?|overview|diagram|visuali[sz]e|folder (tree|structure)|mermaid|explain (the |this )?(project|repo|zip)|what is this (project|zip|repo|code|file)|walk (me )?through|brief me|what(?:'s| is) (in )?this)\b/i.test(
      query,
    );
  if (wantsOverview) {
    const heads = usable
      .map((f) => `### ${f.name}\n${f.text.slice(0, Math.min(budget, 18000))}`)
      .join("\n\n");
    return (
      "You have the real project below. Write like a staffer who read it. " +
      "Name real folders, files, tests, and quotes. If they asked for a diagram, use a mermaid flowchart TB with subgraphs named from real folders — never a circular 'X uses X environment' graph.\n\n" +
      heads.slice(0, budget)
    );
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
  return (
    "Attached local files (excerpts for this question). Stay inside this text. " +
    "Quote names and lines. Write a briefing the reader wants to finish. " +
    "Do not draw a folder diagram unless they asked for one.\n\n" +
    parts.join("\n\n")
  );
}

/** User-visible answer from files already in this tab when the LLM cannot run (Wi-Fi off, model incomplete). */
export function offlineFileBrief(files: NamedDoc[], query: string): string {
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
      return `**${f.name}**\nNo readable text layer in this file. It may be a scanned PDF. Keep Wi-Fi on until the in-browser model finishes downloading, or attach a .txt / .docx copy.`;
    }
    return `**${f.name}**\n${clean}${raw.length > clean.length ? "…" : ""}`;
  });
  return (
    `Wi-Fi is off, so this is taken from the file already on this chat — not the full in-browser model.\n\n` +
    `You asked: ${q}\n\n` +
    blocks.join("\n\n")
  );
}

export function stripStafferLabels(text: string): string {
  const banned =
    /^(#{1,6}\s*)?(\*\*)?(hook|map|overview|key components|useful extras|next move|specific references)(\*\*)?\s*:?\s*$/i;
  return String(text || "")
    .split("\n")
    .flatMap((line) => {
      const t = line.trim();
      if (banned.test(t)) return [];
      let next = line.replace(/\s+overview\s*$/i, "");
      next = next.replace(/\*\*(hook|map|overview|key components|useful extras|next move|specific references)\*\*\s*:?\s*/gi, "");
      next = next.replace(/^(hook|map|overview|key components|useful extras|next move|specific references)\s*:\s*/i, "");
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
    "You are a document agent on this device. Match the user's ask. " +
    "If they asked for interview questions, the whole reply is numbered interview Q&A from the files. " +
    "Otherwise when files are attached: name the project, what it is, real folders and quotes, then what to do next. " +
    "Stay accurate. Prefer attached-file excerpts, then recent chat, then retained memory. " +
    "Do not invent names, jobs, or facts that are not in that context. " +
    "Do not mention Moss, Ollama, WebGPU, or this product unless the user or files do. " +
    "Use retained memory silently. Never reprint it. Never output headings like User Memory Note, Open Tasks, or Retained Information unless the user asked to see the saved summary." +
    mem +
    (extra ? `\n\n${extra}` : "")
  );
}
