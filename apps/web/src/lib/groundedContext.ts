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
    /\b(summar(y|ise|ize)?|overview|brief(?:ly|ing)?|recap)\b/.test(t) ||
    /\bexplain(\s+me)?\b/.test(t) ||
    /\bwhat(?:'s| is| does| are)\s+(this|it|the main|the key)\b/.test(t) ||
    /\bmain things\b/.test(t) ||
    /\bwhat\s+(does\s+)?this\s+include/.test(t) ||
    /\b(tell me|describe)\s+(what\s+)?(this|the\s+file|the\s+attachment)\b/.test(t) ||
    (/\b(include[sd]?|consist|contain)\b/.test(t) && /\b(this|file|attachment|zip|doc|resume)\b/.test(t)) ||
    /\bwhat is this\b/.test(t) ||
    /\bwhat (is|are) (in )?this (resume|file|doc|document|pdf|json|code)\b/.test(t) ||
    /\bwalk (me )?through\b/.test(t) ||
    /\bexplain (the |this )?(project|repo|zip|file|resume|code|json)\b/.test(t)
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
    if (age) return `${age}${cite}`;
    const dob = hit(
      /\b(?:dob|date of birth|born(?:\s+on)?)\s*[:\-–]?\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}|\d{1,2}\s+[A-Za-z]+\s+\d{4}|[A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4})\b/i,
    );
    if (dob) return `Date of birth in the file: ${dob}. Age as a number is not written.${cite}`;
    return `Age is not written in this file.${cite}`;
  }

  if (/\be-?mail\b/.test(q)) {
    const email = hit(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
    return email ? `${email}${cite}` : `No email found in this file.${cite}`;
  }

  if (/\b(phone|mobile|contact number|whatsapp)\b/.test(q)) {
    const labeled =
      hit(/\b(?:phone|mobile|tel|cell|whatsapp)\s*[:\-–]?\s*([+\d][\d\s().\-]{7,}\d)/i) ||
      hit(/(?:\+?\d{1,3}[\s\-.]?)?(?:\(?\d{2,5}\)?[\s\-.]?)?\d{3,5}[\s\-.]?\d{3,5}(?:[\s\-.]?\d{2,5})?/);
    return labeled ? `${labeled}${cite}` : `No phone number found in this file.${cite}`;
  }

  if (/\blinkedin\b/.test(q)) {
    const url = hit(/\b((?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s]+)/i);
    return url ? `${url}${cite}` : `No LinkedIn URL found in this file.${cite}`;
  }

  if (/\b(who is|name)\b/.test(q)) {
    const name =
      hit(/\b(?:name|candidate)\s*[:\-–]\s*([A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){1,3})\b/) ||
      usable[0]?.name.replace(/\.(pdf|docx?|txt)$/i, "").replace(/[_-]+/g, " ");
    if (name && name.length > 2) return `${name}${cite}`;
  }

  if (/\b(title|role|designation)\b/.test(q)) {
    const title =
      hit(/\b(?:title|role|designation|position)\s*[:\-–]\s*([^\n]{3,80})/i) ||
      hit(
        /\b((?:senior|junior|lead|staff|principal)?\s*(?:software|data|ml|ai|full[\s-]?stack|backend|frontend|devops)?\s*(?:engineer|developer|analyst|scientist|manager|architect)[^\n]{0,40})/i,
      );
    if (title) return `${title.trim()}${cite}`;
  }

  if (/\b(company|employer|organization)\b/.test(q)) {
    const co = hit(/\b(?:company|employer|organization|at)\s*[:\-–]?\s*([A-Z][^\n,]{2,60})/);
    if (co) return `${co.trim()}${cite}`;
  }

  if (/\b(location|city|address|based)\b/.test(q)) {
    const loc =
      hit(/\b(?:location|city|address|based in)\s*[:\-–]?\s*([^\n]{3,80})/i) ||
      hit(/\b([A-Z][a-z]+(?:[\s,]+[A-Z][a-z]+){0,3},\s*[A-Z]{2,})\b/);
    if (loc) return `${loc.trim()}${cite}`;
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

function humanKey(k: string): string {
  return k
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

function explainKeyPurpose(key: string): string {
  const k = key.toLowerCase();
  if (/contact|people|recruiter|target/.test(k)) return "who to reach (people / hiring contacts)";
  if (/message|outreach|template|invite|note/.test(k)) return "ready-to-send wording so you do not rewrite each invite";
  if (/linkedin|url|link|href/.test(k)) return "a web profile or page to open";
  if (/email|mail/.test(k)) return "an email address for contact";
  if (/phone|mobile|tel/.test(k)) return "a phone number for contact";
  if (/role|title|designation|position/.test(k)) return "job title / how this person shows up at work";
  if (/company|org|employer/.test(k)) return "where they work";
  if (/relevance|why|reason|note/.test(k)) return "why this entry matters for your goal";
  if (/script/.test(k)) return "commands you can run (npm / shell shortcuts)";
  if (/dependenc/.test(k)) return "libraries the project needs installed";
  if (/version/.test(k)) return "release / version tracking";
  if (/^main$|entry/.test(k)) return "the starting file of a program";
  if (/name/.test(k)) return "a human or project label";
  if (/date|time|created|updated/.test(k)) return "when something happened";
  if (/amount|price|total|balance|debit|credit/.test(k)) return "money / quantity figures";
  if (/skill|tech|stack/.test(k)) return "abilities or tools highlighted on purpose";
  if (/experience|work|employment|history/.test(k)) return "past roles and proof of work";
  if (/education|school|degree|university/.test(k)) return "schooling / credentials";
  if (/summary|about|bio|profile/.test(k)) return "a short overview of the person or project";
  if (/id|uuid|key/.test(k)) return "a unique id so records do not get mixed up";
  if (/status|state/.test(k)) return "current state of an item";
  if (/config|setting|option/.test(k)) return "settings that change how something runs";
  return `holds “${humanKey(key)}” data so it can be found and reused`;
}

function explainPackageJson(name: string, raw: string): string | null {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!("scripts" in j || "dependencies" in j || "devDependencies" in j || j.main)) return null;
    const lines: string[] = [
      `This is a **Node.js package.json** for the project **${String(j.name || name.replace(/\.json$/i, ""))}** [${name}]. It tells npm/Node *what the app is* and *how to run it* — it is not the app logic itself.`,
    ];
    if (j.version) lines.push(`- **version** (\`${j.version}\`) — tracks releases of this package.`);
    if (j.description) lines.push(`- **description** — short human summary of what the project is for.`);
    if (j.main) {
      lines.push(
        `- **main** (\`${j.main}\`) — the entry file Node loads when something \`require\`s this package. That is why this path is listed: it is the starting point of the program.`,
      );
    }
    if (j.scripts && typeof j.scripts === "object") {
      const scripts = Object.entries(j.scripts as Record<string, string>).slice(0, 8);
      lines.push(
        `- **scripts** — named shortcuts you run with \`npm run …\`. They exist so you do not type long shell commands. Examples here: ${scripts
          .map(([k, v]) => `\`${k}\` → \`${v}\``)
          .join("; ")}.`,
      );
    }
    const deps = j.dependencies && typeof j.dependencies === "object" ? Object.keys(j.dependencies as object) : [];
    const dev = j.devDependencies && typeof j.devDependencies === "object" ? Object.keys(j.devDependencies as object) : [];
    if (deps.length) {
      lines.push(
        `- **dependencies** (${deps.slice(0, 10).map((d) => `\`${d}\``).join(", ")}${deps.length > 10 ? ", …" : ""}) — libraries the app needs **when it runs**. Listed so \`npm install\` can fetch them.`,
      );
    }
    if (dev.length) {
      lines.push(
        `- **devDependencies** (${dev.slice(0, 8).map((d) => `\`${d}\``).join(", ")}${dev.length > 8 ? ", …" : ""}) — tools used while building/testing, not required in production.`,
      );
    }
    lines.push("In short: this file is the project’s **recipe card** for install and run — not a dump of the source code.");
    return lines.join("\n");
  } catch {
    return null;
  }
}

type Contactish = {
  name?: string;
  role?: string;
  title?: string;
  linkedin?: string;
  company?: string;
  message?: string;
  relevance?: string;
};

function asContactList(val: unknown): Contactish[] {
  if (!Array.isArray(val)) return [];
  return val.filter((x) => x && typeof x === "object") as Contactish[];
}

function explainContactsJson(name: string, data: Record<string, unknown> | unknown[]): string | null {
  const rootArr = Array.isArray(data);
  const obj: Record<string, unknown> = rootArr ? { list: data } : (data as Record<string, unknown>);
  const keys = Object.keys(obj);
  const contactKeys = keys.filter((k) =>
    /contact|people|recruiter|outreach|message|linkedin|connection|target|list/i.test(k),
  );
  let contacts: Contactish[] = [];
  let listKey = "";
  for (const k of contactKeys.length ? contactKeys : keys) {
    const list = asContactList(obj[k]);
    if (list.length && (list[0].name || list[0].role || list[0].linkedin || list[0].message || list[0].title)) {
      contacts = list;
      listKey = k;
      break;
    }
  }
  if (!contacts.length) return null;

  const sample = contacts.slice(0, 4);
  const lines: string[] = [
    `This file **[${name}]** is a **LinkedIn / networking outreach pack** — saved contacts and short connection notes so you can message the right people for a job or intro.`,
    `- **Why it exists:** keep recruiter/peer targets + ready-to-send lines in one place (often under LinkedIn’s invite character limit).`,
  ];
  if (listKey && listKey !== "list") {
    lines.push(
      `- **\`${listKey}\`** — ${explainKeyPurpose(listKey)}. That key is present so you (or a tool) can load “who to contact” without digging through prose.`,
    );
  }
  lines.push(`- **${contacts.length} contact(s)** in this file. Examples:`);
  for (const c of sample) {
    const who = [c.name, c.role || c.title, c.company].filter(Boolean).join(" — ");
    lines.push(`  - ${who || "Contact"}${c.linkedin ? ` · LinkedIn saved` : ""}`);
  }
  if (contacts.some((c) => c.message || c.relevance)) {
    lines.push(
      `- **message / relevance fields** — draft invite text and *why this person matters* for the role. They are here so you can copy-paste a tailored note instead of writing from scratch.`,
    );
  }
  const other = keys.filter((k) => k !== listKey);
  if (other.length) {
    lines.push(
      `- Other top-level fields: ${other
        .slice(0, 6)
        .map((k) => `\`${k}\` (${explainKeyPurpose(k)})`)
        .join("; ")}.`,
    );
  }
  lines.push("In short: use it as a **call sheet + message crib** for outreach — not as random JSON to dump back.");
  return lines.join("\n");
}

function explainJsonValueShape(v: unknown): string {
  if (v == null) return "empty";
  if (Array.isArray(v)) return `a list of ${v.length} item(s)`;
  if (typeof v === "object") return `an object with ${Object.keys(v as object).length} field(s)`;
  if (typeof v === "string") return `text (“${String(v).slice(0, 40)}${String(v).length > 40 ? "…" : ""}”)`;
  return typeof v;
}

function explainGenericJson(name: string, raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const pkg = explainPackageJson(name, raw);
      if (pkg) return pkg;
      const contacts = explainContactsJson(name, obj);
      if (contacts) return contacts;
      const keys = Object.keys(obj).slice(0, 14);
      if (!keys.length) return null;
      const lines = [
        `This is a **JSON data file** **[${name}]** — structured records so a program or person can read each field reliably.`,
        `- **Why JSON:** named fields beat a wall of prose when you need to look up or reuse data.`,
        `- **What’s inside (and why those keys are there):**`,
      ];
      for (const k of keys) {
        lines.push(`  - \`${k}\` — ${explainKeyPurpose(k)}; here it is ${explainJsonValueShape(obj[k])}.`);
      }
      lines.push("Ask about one field if you want a deeper walkthrough of its contents.");
      return lines.join("\n");
    }
    if (Array.isArray(parsed)) {
      const contacts = explainContactsJson(name, parsed);
      if (contacts) return contacts;
      const first = parsed[0];
      const sampleKeys =
        first && typeof first === "object" && !Array.isArray(first)
          ? Object.keys(first as object).slice(0, 8)
          : [];
      return (
        `This is a **JSON list** **[${name}]** with **${parsed.length}** items.\n` +
        `- A list is used when many similar records matter (contacts, messages, rows, events).\n` +
        (sampleKeys.length
          ? `- Each item tends to include: ${sampleKeys.map((k) => `\`${k}\` (${explainKeyPurpose(k)})`).join("; ")}.\n`
          : "") +
        `- Ask about one item or field for more detail.`
      );
    }
  } catch {
    return null;
  }
  return null;
}

function explainCsv(name: string, raw: string): string | null {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, "")).filter(Boolean);
  if (headers.length < 2) return null;
  return (
    `This is a **spreadsheet / table export** **[${name}]** (${lines.length - 1} data row(s)).\n` +
    `- **Why a table:** each column is a field you can sort, filter, or total.\n` +
    `- **Columns (and why they’re named):** ${headers
      .slice(0, 12)
      .map((h) => `\`${h}\` — ${explainKeyPurpose(h)}`)
      .join("; ")}.\n` +
    `- Rows under those headers are the actual records. Ask about a column or total if you need numbers.`
  );
}

function explainCodeFile(name: string, raw: string): string | null {
  if (!/\.(py|js|jsx|ts|tsx|mjs|cjs|go|rs|java|rb|php|cs|cpp|c|h|swift|kt|sql|sh|bash|zsh)$/i.test(name)) return null;
  const lang = name.split(".").pop() || "code";
  const defs = [
    ...raw.matchAll(
      /\b(?:function|class|def|export\s+(?:async\s+)?function|export\s+class|const|let|fn|pub\s+fn|func|CREATE\s+TABLE)\s+([A-Za-z_][\w]*)/gi,
    ),
  ]
    .map((m) => m[1])
    .filter((n) => n.length > 1 && !/^(const|let|var|export|async|from|table)$/i.test(n));
  const uniq = [...new Set(defs)].slice(0, 10);
  const imports = [...raw.matchAll(/^(?:import|from|require\(|use\s)/gm)].length;
  return (
    `This is a **${lang} source file** **[${name}]** — program logic, not a config dump.\n` +
    `- **Why it exists:** implements behavior the app runs (functions, classes, routes, helpers).\n` +
    (imports ? `- **Imports / requires** appear so this file can reuse libraries or other modules.\n` : "") +
    (uniq.length
      ? `- **Named pieces here:** ${uniq.map((n) => `\`${n}\``).join(", ")} — those names mark units you can call or test.\n`
      : "") +
    `- Ask “what does X do?” for a specific function or class.`
  );
}

function explainYamlOrEnv(name: string, raw: string): string | null {
  const isEnv = /\.env/i.test(name) || (/^[A-Z][A-Z0-9_]+=\S+/m.test(raw) && !raw.trimStart().startsWith("{"));
  const isYaml =
    /\.(ya?ml|toml|ini|conf|cfg)$/i.test(name) ||
    (/^[\w.-]+:\s/m.test(raw) && !raw.trimStart().startsWith("{") && !raw.includes("function "));
  if (!isEnv && !isYaml) return null;
  if (isEnv) {
    const keys = [...raw.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]).slice(0, 12);
    return (
      `This is an **environment / secrets-style config** **[${name}]**.\n` +
      `- **Why it exists:** values that change per machine (API keys, URLs, flags) without editing source code.\n` +
      (keys.length
        ? `- **Keys present:** ${keys.map((k) => `\`${k}\``).join(", ")} — each name marks one setting so the app can read it at startup.\n`
        : "") +
      `- I explain what keys are for; I do not repeat secret values.`
    );
  }
  const keys = [...raw.matchAll(/^([A-Za-z_][\w.-]*)\s*:/gm)].map((m) => m[1]).slice(0, 14);
  return (
    `This is a **YAML/TOML-style config** **[${name}]**.\n` +
    `- **Why it exists:** human-editable settings for deploy, CI, or an app — named keys beat hard-coding.\n` +
    (keys.length
      ? `- **Top keys:** ${keys.map((k) => `\`${k}\` (${explainKeyPurpose(k)})`).join("; ")}.\n`
      : "") +
    `- Ask about one key if you want what that setting controls.`
  );
}

function explainMarkup(name: string, raw: string): string | null {
  if (!/\.(html?|xml|svg)$/i.test(name) && !/^\s*<[!?]?[A-Za-z]/.test(raw)) return null;
  const tags = [...raw.matchAll(/<\/?([A-Za-z][\w:-]*)/g)].map((m) => m[1].toLowerCase());
  const uniq = [...new Set(tags.filter((t) => !["html", "head", "body", "meta", "link", "script", "style"].includes(t)))].slice(
    0,
    12,
  );
  const kind = /\.svg$/i.test(name) ? "SVG graphic markup" : /\.xml$/i.test(name) ? "XML data document" : "HTML page markup";
  return (
    `This is **${kind}** **[${name}]**.\n` +
    `- **Why it exists:** structure content for a browser or another program that reads tags.\n` +
    (uniq.length ? `- **Notable tags:** ${uniq.map((t) => `\`${t}\``).join(", ")} — each tag names a kind of content or layout piece.\n` : "") +
    `- Ask about a section or tag if you want what that piece is for.`
  );
}

function explainPptxOrSlides(name: string, raw: string): string | null {
  if (!/\.(pptx?|odp)$/i.test(name) && !/^Slide\s*\d+/im.test(raw) && !/^---\s*slide/im.test(raw)) return null;
  const slides = [...raw.matchAll(/^Slide\s*(\d+)[:\s]*(.*)$/gim)].slice(0, 10);
  const titles = slides.map((m) => (m[2] || `Slide ${m[1]}`).trim()).filter(Boolean);
  return (
    `This is a **presentation / slides extract** **[${name}]**.\n` +
    `- **Why it exists:** talk track in chunks — one idea per slide for a live audience.\n` +
    (titles.length
      ? `- **Slides spotted:** ${titles.map((t) => `“${t.slice(0, 60)}${t.length > 60 ? "…" : ""}”`).join("; ")}.\n`
      : "") +
    `- Ask about one slide if you want that section explained.`
  );
}

function explainMarkdownOrProse(name: string, raw: string): string {
  const headings = [...raw.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 10);
  const labeled = [...raw.matchAll(/^([A-Za-z][A-Za-z0-9 /&-]{1,40})\s*[:|\-|–]\s*(.+)$/gm)]
    .map((m) => ({ k: m[1].trim(), v: m[2].trim().slice(0, 80) }))
    .filter((x) => x.k.length > 1 && x.v.length > 1)
    .slice(0, 10);
  const emails = [...raw.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map((m) => m[0]);
  const urls = [...raw.matchAll(/https?:\/\/[^\s)]+/gi)].map((m) => m[0]).slice(0, 5);
  const bullets = [...raw.matchAll(/^\s*[-*•]\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 8);

  const kind = /\.md$/i.test(name)
    ? "Markdown notes / README"
    : /\.pdf$/i.test(name)
      ? "PDF text extract"
      : /\.docx?$/i.test(name)
        ? "Word document text"
        : "text document";

  const lines: string[] = [
    `This is a **${kind}** **[${name}]**.`,
    `- **Purpose:** hold readable information (story, instructions, résumé, notes) so you can ask about meaning — not so I paste it back.`,
  ];

  if (/linkedin|outreach|connection message|talent acquisition|recruiter/i.test(raw) && /hi[, ]/i.test(raw)) {
    const names = [...raw.matchAll(/Name:\s*([^\n|]+)/gi)].map((m) => m[1].trim()).slice(0, 5);
    return (
      `This file **[${name}]** is a **LinkedIn outreach / connection-message guide**.\n` +
      `- **Purpose:** short invite notes aimed at recruiters or peers for a specific role.\n` +
      `- **Why contacts are listed:** so you know *who* to message and *why they matter*.\n` +
      (names.length ? `- **People called out:** ${names.join("; ")}.\n` : "") +
      `- **Why the quoted “Hi …” lines exist:** ready-to-send templates — copy, personalize, send.`
    );
  }

  if (/experience|education|skills|resume|curriculum/i.test(raw) && (headings.length || labeled.length || bullets.length)) {
    lines[0] = `This looks like a **résumé / profile document** **[${name}]**.`;
    lines.push(`- **Why those sections exist:** hiring readers scan Experience, Skills, Education quickly — each block answers a different question about you.`);
  }

  if (headings.length) {
    lines.push(
      `- **Sections:** ${headings.map((h) => `**${h}**`).join("; ")} — headings exist to jump to topics without reading everything.`,
    );
  }
  if (labeled.length) {
    lines.push(`- **Labeled fields in the text:**`);
    for (const { k, v } of labeled.slice(0, 6)) {
      lines.push(`  - **${k}** — ${explainKeyPurpose(k)}; e.g. “${v}${v.length >= 80 ? "…" : ""}”`);
    }
  }
  if (bullets.length && !headings.length) {
    lines.push(
      `- **Bullet points** (${bullets.length}+) — used to list facts or steps clearly (e.g. ${bullets
        .slice(0, 3)
        .map((b) => `“${b.slice(0, 50)}${b.length > 50 ? "…" : ""}”`)
        .join("; ")}).`,
    );
  }
  if (emails.length) lines.push(`- **Email(s) found:** ${[...new Set(emails)].slice(0, 3).join(", ")} — listed for contact.`);
  if (urls.length) lines.push(`- **Links found:** ${urls.length} URL(s) — so you can open profiles or references.`);

  lines.push("Ask “why is X here?” or name a section for a deeper explanation.");
  return lines.join("\n");
}

/**
 * Universal explainer for any attachment text — works offline.
 * Never dumps the raw file; teaches what it is and why parts exist.
 */
function explainOneFile(f: NamedDoc): string {
  const raw = String(f.text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return `**[${f.name}]** — no readable text in this attachment.`;

  // Zip / project tree
  if (/Extracted zip|File tree/i.test(raw)) {
    const paths = pathsFromFiles([f]).slice(0, 12);
    const root = paths[0]?.split("/")[0] || f.name;
    return (
      `This is an unpacked project archive **[${f.name}]** (root \`${root}\`).\n` +
      `- The tree lists folders so you can see how the code is organized.\n` +
      (paths.length
        ? `- Notable paths: ${paths
            .slice(0, 8)
            .map((p) => `\`${p}\``)
            .join(", ")}.\n`
        : "") +
      `- Those folders exist to separate app code, tests, scripts, and results — not to be pasted back as the answer.`
    );
  }

  if (/\.json$/i.test(f.name) || raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    const explained = explainGenericJson(f.name, raw);
    if (explained) return explained;
  }

  if (/\.(csv|tsv)$/i.test(f.name) || (raw.includes("\n") && raw.split("\n")[0].split(/,|\t/).length >= 3)) {
    const csv = explainCsv(f.name, raw);
    if (csv) return csv;
  }

  const slides = explainPptxOrSlides(f.name, raw);
  if (slides) return slides;

  const yamlEnv = explainYamlOrEnv(f.name, raw);
  if (yamlEnv) return yamlEnv;

  const markup = explainMarkup(f.name, raw);
  if (markup) return markup;

  const code = explainCodeFile(f.name, raw);
  if (code) return code;

  // Spreadsheet-ish sheets from xlsx extract
  if (/^Sheet:/m.test(raw) || /\t.*\t/.test(raw)) {
    const sheetNames = [...raw.matchAll(/^Sheet:\s*(.+)$/gm)].map((m) => m[1].trim());
    return (
      `This looks like a **spreadsheet extract** **[${f.name}]**.\n` +
      (sheetNames.length ? `- **Sheets:** ${sheetNames.map((s) => `\`${s}\``).join(", ")} — separate tabs for different tables.\n` : "") +
      `- Rows and columns hold the real numbers/names; ask for a total, account, or column if you need figures.`
    );
  }

  if (/\.lock$/i.test(f.name) || /package-lock|yarn\.lock|pnpm-lock|Cargo\.lock/i.test(f.name)) {
    return (
      `This is a **dependency lockfile** **[${f.name}]**.\n` +
      `- **Why it exists:** pins exact library versions so installs stay reproducible across machines.\n` +
      `- It is machine-generated — ask about a package name if you care what one dependency is for.`
    );
  }

  return explainMarkdownOrProse(f.name, raw);
}

/**
 * Explain what each attached file is for and why key parts exist — never dump the raw file.
 * Used online and offline for “what is this / briefly explain”.
 */
export function extractiveFileOverview(files: NamedDoc[], _maxPerFile = 2400): string {
  void _maxPerFile;
  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) return "";
  return usable.map(explainOneFile).join("\n\n");
}

const OVERVIEW_OVERRIDE =
  "OVERRIDE: The user wants UNDERSTANDING, not a file dump. " +
  "Explain what this file is for and why key fields, scripts, sections, or symbols are present — like a teacher. " +
  "Use short bullets. Cite [filename]. Do NOT paste JSON, code, or the whole document. " +
  "Do NOT describe your role or the chat UI.\n\n";

const FILE_GROUND =
  "CONTEXT (attached sources) follows. You are a human-like document expert. " +
  "Read typos and messy wording generously — infer what the user meant and answer that intent. " +
  "When they ask what/why/explain/briefly: teach the meaning and purpose of fields, scripts, and sections — never paste the raw file. " +
  "Cite with [filename]. Match length to the ask. " +
  "For images: you cannot see pixels. For spreadsheets, use the sheet grids. " +
  "Do not invent facts missing from CONTEXT.\n\n";

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
    [/\bbreifly\b/gi, "briefly"],
    [/\bbreif\b/gi, "brief"],
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

/** Fallback when the in-browser model cannot run — explain, never dump the file. */
export function offlineFileBrief(files: NamedDoc[], query: string, reason: "offline" | "no-model" = "offline"): string {
  void reason;
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const q = query.trim() || "What is in these files?";

  const fact = extractiveFactAnswer(usable, q);
  if (fact) return fact;

  if (wantsDiagram(q)) {
    const diagram = architectureFlowFromFiles(usable);
    if (diagram) return diagram;
  }
  if (wantsInterviewQuestions(q)) {
    return extractiveInterviewQuestions(usable);
  }
  // Default for explain / what is this / briefly: purpose-first overview
  if (wantsFileOverview(q) || /\bexplain|brief|what is|about\b/i.test(q)) {
    const overview = extractiveFileOverview(usable);
    if (overview) return overview;
  }

  // Still prefer explanation over dumping a random chunk
  const overview = extractiveFileOverview(usable);
  if (overview) return overview;

  return `I could not find a clear answer in the attached file for: ${q}`;
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
    "Infer the user’s real intent even when spelling is wrong. " +
    "For explain / what is this / briefly: teach why fields, scripts, and sections exist — never paste the raw file. " +
    "One fact → one short line with [filename]. " +
    "Do not invent facts missing from CONTEXT. Never summarize your role. " +
    "Do not mention product internals unless asked. Use retained memory silently." +
    mem +
    (extra ? `\n\n${extra}` : "")
  );
}
