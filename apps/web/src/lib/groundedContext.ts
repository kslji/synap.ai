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
  const t = String(model || "");
  return /1b|1\.5b|1\.5\s*b|2b|in-browser|qwen2\.5:1\.5/i.test(t);
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
    // "what is harbour file about" / "harbour file is about"
    /\bwhat\s+(is|are)\s+\S[\w.+-]{1,48}\s+(file|zip|pdf|doc|document|project|repo)\b/.test(t) ||
    /\b[\w.+-]{3,48}\s+(file|zip|pdf)\s+(is\s+)?about\b/.test(t) ||
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
  // Do not treat broad “what is this / summarize” as a single-field fact.
  if (
    /\b(summar(y|ise|ize)?|overview|brief(?:ly)?|what is this|walk (me )?through|explain (the |this )?(file|doc|zip|project))\b/.test(
      t,
    ) &&
    !/\b(experience|exp\.?|tenure|how long|how much)\b/.test(t)
  ) {
    return false;
  }
  return (
    /\b(how old|years?\s*old|date of birth|\bdob\b|\bage\b)\b/.test(t) ||
    /\b(e-?mail|phone|mobile|contact number|whatsapp|linkedin)\b/.test(t) ||
    /\bwhat(?:'s| is| was)\s+(his|her|their|the person'?s?|this (person|candidate)'?s?)\s+(name|age|email|phone|number|address|title|role|company|location|city)\b/.test(
      t,
    ) ||
    /\b(name|age|email|phone|number|address|title|role|company)\s+(of|for)\s+(the |this )?(person|candidate|author|user)?\b/.test(
      t,
    ) ||
    /\bwho is (this|the) (person|candidate|author)\b/.test(t) ||
    /\b(how (much|long)|years?|months?|tenure|duration)?\s*(of\s+)?(experience|exp\.?|worked|work(ed|ing)?)\b/.test(t) ||
    /\b(experience|exp\.?)\s+(at|in|with|for)\b/.test(t) ||
    (/\b(at|in|with)\s+[A-Za-z0-9][\w+.&' -]{1,40}\b/.test(t) &&
      /\b(experience|exp\.?|role|title|worked|work|job|tenure)\b/.test(t))
  );
}

function looksLikeResumeOrCv(name: string, raw: string): boolean {
  if (/\.(ya?ml|toml|ini|env|conf|cfg)$/i.test(name)) return false;
  const t = raw.slice(0, 4000);
  const hits = [
    /professional\s+experience/i,
    /work\s+experience/i,
    /education/i,
    /technical\s+skills/i,
    /curriculum\s+vitae|\bresume\b/i,
    /\b(bachelor|master|b\.?tech|m\.?tech|university)\b/i,
    /\b(software|senior|junior)?\s*(engineer|developer|sde)\b/i,
  ].filter((re) => re.test(t)).length;
  if (/\.pdf$/i.test(name) && hits >= 1) return true;
  return hits >= 2;
}

/** Pull role + dates for a named company from résumé text. */
function extractCompanyExperience(blob: string, query: string, cite: string): string | null {
  const q = query.toLowerCase();
  // Prefer quoted / distinctive tokens (Park+, Acme, …)
  const fromQuery =
    query.match(/\b(?:at|in|with|for|about)\s+([A-Za-z0-9][\w+.&'’-]{1,40})/i)?.[1] ||
    query.match(/\b([A-Za-z][\w+.&'’-]{1,30}\+|\bPark\+?)\b/i)?.[1] ||
    "";
  let needle = (fromQuery || "").replace(/\+$/, "").trim();
  if (!needle || /^(the|this|his|her|their|a|an|my|your|experience|exp|person|candidate)$/i.test(needle)) {
    // Last capitalized-ish token from query that appears in the blob
    const cands = [...query.matchAll(/\b([A-Za-z][A-Za-z0-9+.&'’-]{2,40})\b/g)].map((m) => m[1]);
    needle =
      cands.reverse().find((c) => {
        if (/^(how|much|does|the|person|have|experience|exp|please|specific|in|at|with|for)$/i.test(c)) {
          return false;
        }
        return blob.toLowerCase().includes(c.toLowerCase().replace(/\+$/, ""));
      }) || "";
  }
  if (!needle) return null;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\+$/, "\\+?");
  // Word-ish boundary so “Park” does not match inside “PySpark”.
  const needleRe = new RegExp(`(?:^|[^A-Za-z0-9])(${esc})(?![A-Za-z0-9])`, "i");
  const lines = blob.split(/\r?\n/);
  let hitIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (needleRe.test(lines[i])) {
      hitIdx = i;
      break;
    }
  }
  if (hitIdx < 0) {
    return `No role at “${needle}” is written in this file.${cite}`;
  }
  // Prefer a title/company line over a skills line that only mentions the token.
  for (let j = hitIdx; j >= Math.max(0, hitIdx - 2); j--) {
    const cand = lines[j].replace(/\s+/g, " ").trim();
    if (
      /(engineer|developer|sde|manager|analyst|architect|intern|consultant)/i.test(cand) ||
      new RegExp(`,\\s*${esc}`, "i").test(cand)
    ) {
      hitIdx = j;
      break;
    }
  }
  // Role line often is the hit; dates often on next 1–3 lines
  const window = lines.slice(Math.max(0, hitIdx - 1), hitIdx + 6).join("\n");
  const roleLine = lines[hitIdx].replace(/\s+/g, " ").trim();
  if (/^(languages|databases|technologies|skills|testing|practices)\s*:/i.test(roleLine)) {
    // Landed on a skills label — search again for a role line containing the company.
    for (let i = 0; i < lines.length; i++) {
      const cand = lines[i].replace(/\s+/g, " ").trim();
      if (!needleRe.test(cand)) continue;
      if (/(engineer|developer|sde|manager|,)/i.test(cand) && !/^(languages|databases|technologies)\s*:/i.test(cand)) {
        hitIdx = i;
        break;
      }
    }
  }
  const window2 = lines.slice(Math.max(0, hitIdx - 1), hitIdx + 6).join("\n");
  const roleLine2 = lines[hitIdx].replace(/\s+/g, " ").trim();
  const date =
    window2.match(
      /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})\s*[-–—to]+\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|Present|Current|Now)/i,
    ) ||
    window2.match(/\b(\d{1,2}\/\d{4})\s*[-–—to]+\s*(\d{1,2}\/\d{4}|Present|Current)/i);
  const dateStr = date ? `${date[1]} – ${date[2]}` : "";
  // Rough tenure if both month-year present
  let tenure = "";
  if (date && !/present|current|now/i.test(date[2])) {
    const parse = (s: string) => {
      const m = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{4})/i);
      if (!m) return null;
      const months: Record<string, number> = {
        jan: 0,
        feb: 1,
        mar: 2,
        apr: 3,
        may: 4,
        jun: 5,
        jul: 6,
        aug: 7,
        sep: 8,
        oct: 9,
        nov: 10,
        dec: 11,
      };
      return { y: Number(m[2]), m: months[m[1].slice(0, 3).toLowerCase()] ?? 0 };
    };
    const a = parse(date[1]);
    const b = parse(date[2]);
    if (a && b) {
      const months = (b.y - a.y) * 12 + (b.m - a.m);
      if (months >= 0 && months < 120) {
        const yrs = Math.floor(months / 12);
        const mos = months % 12;
        tenure =
          yrs > 0 && mos > 0
            ? `${yrs} year${yrs > 1 ? "s" : ""} ${mos} month${mos > 1 ? "s" : ""}`
            : yrs > 0
              ? `${yrs} year${yrs > 1 ? "s" : ""}`
              : `${Math.max(1, mos)} month${mos === 1 ? "" : "s"}`;
      }
    }
  }
  const bits = [roleLine2];
  if (dateStr) bits.push(dateStr);
  if (tenure) bits.push(`about ${tenure}`);
  return `${bits.join(" · ")}${cite}`;
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

  if (
    /\b(experience|exp\.?|worked|tenure|how long|how much)\b/.test(q) ||
    (/\b(at|in|with)\b/.test(q) && /\b(experience|exp\.?|role|job)\b/.test(q))
  ) {
    const company = extractCompanyExperience(blob, query, cite);
    if (company) return company;
  }

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
    /\b(mermaid|flowchart|flow\s*-?\s*chart|diagram|visuali[sz]e|visuali[sz]?ing|architecture\s+(diagram|map|chart|flow)|draw\s+(a\s+)?(flow|diagram|chart|architecture)|show\s+(me\s+)?(a\s+)?(flow|diagram|chart|architecture)|make\s+(a\s+)?(flow|diagram|chart))\b/.test(
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
    if (/^(https?:|mailto:|file tree|extracted zip|no plain-text|summarize from|folder questions)/i.test(norm)) {
      return;
    }
    if (!/[\\/]/.test(norm) && !/\.[A-Za-z0-9]{1,12}$/.test(norm)) {
      // bare folder name without slash still ok if it looks like a project root
      if (!/^[A-Za-z0-9._-]+$/.test(norm)) return;
    }
    if (!/[A-Za-z0-9._-]+/.test(norm)) return;
    paths.push(norm);
  };
  for (const line of blob.split(/\r?\n/)) {
    const rawLine = line.trim();
    if (!rawLine) continue;
    // Excerpt fences look like "--- path/to/file ---" — never treat as tree bullets.
    if (/^---/.test(rawLine)) continue;
    const t = rawLine.replace(/^\d+\.\s*/, "").replace(/^[-*•]\s*/, "");
    if (!t) continue;
    if (/^file tree/i.test(t)) {
      const after = t.replace(/^file tree[^:]*:\s*/i, "");
      if (after && after !== t) {
        for (const part of after.split(/\s+/)) push(part);
      }
      continue;
    }
    if (/^(extracted zip|summarize from|folder questions)/i.test(t)) continue;
    // Bulleted tree: paths with slash, dirs, OR bare files (README.md) / simple names
    if (
      /[\\/]/.test(t) ||
      t.endsWith("/") ||
      /\.[A-Za-z0-9]{1,12}$/.test(t) ||
      /^[A-Za-z0-9._-]{1,80}$/.test(t)
    ) {
      push(t.replace(/\/+$/, ""));
    }
  }
  // Also harvest --- path --- excerpt headers when the tree line parse failed
  if (!paths.length) {
    for (const m of blob.matchAll(/---\s+([^\n]+?)\s+---/g)) {
      push(m[1]);
    }
  }
  return [...new Set(paths)];
}

function mermaidSafeLabel(s: string): string {
  return String(s || "")
    .replace(/["\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
}

function mermaidNodeId(s: string): string {
  const base =
    "N" +
    String(s || "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 28);
  return base || "N0";
}

/** Section / heading diagram when there is no zip file tree. */
function documentStructureFlow(files: NamedDoc[]): string | null {
  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) return null;
  const f = usable[0];
  const raw = String(f.text || "");
  const title =
    mermaidSafeLabel(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")) || "Document";
  const sectionHits: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.length > 60) continue;
    if (/^#{1,3}\s+(.+)/.test(t)) {
      sectionHits.push(mermaidSafeLabel(t.replace(/^#+\s+/, "")));
      continue;
    }
    if (/^[A-Z][A-Z0-9 &/().-]{3,48}$/.test(t) && !/^(HTTP|HTTPS|API|URL|PDF|JSON)$/.test(t)) {
      sectionHits.push(mermaidSafeLabel(t));
      continue;
    }
    if (
      /^(professional|work)\s+experience|technical\s+skills|education|projects?|summary|certifications?|skills|experience\b/i.test(
        t,
      )
    ) {
      sectionHits.push(mermaidSafeLabel(t));
    }
    if (sectionHits.length >= 8) break;
  }
  const uniq = [...new Set(sectionHits.filter(Boolean))].slice(0, 8);
  const root = mermaidNodeId("doc");
  const lines = [`flowchart TB`, `  ${root}["${title}"]`];
  const kids =
    uniq.length >= 2
      ? uniq
      : [
          mermaidSafeLabel(f.name.split(/[/\\]/).pop() || "File"),
          "Contents",
          "Ask follow-ups",
        ];
  kids.forEach((s, i) => {
    const id = mermaidNodeId(`${i}_${s}`);
    lines.push(`  ${id}["${s}"]`);
    lines.push(`  ${root} --> ${id}`);
  });
  const label =
    uniq.length >= 2
      ? `Diagram of **[${f.name}]** from its sections:`
      : `Diagram of **[${f.name}]** (structure overview):`;
  return `${label}\n\n\`\`\`mermaid\n${lines.join("\n")}\n\`\`\``;
}

/**
 * Build a Mermaid flowchart from zip file-tree lines so light models still show a diagram.
 * Falls back to document/section structure for resumes and single files.
 */
export function architectureFlowFromFiles(files: NamedDoc[]): string | null {
  const paths = pathsFromFiles(files);
  if (paths.length >= 2) {
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
    if (entries.length) {
      const [root, kids] = entries[0];
      const lines = [
        `flowchart TB`,
        `  ${mermaidNodeId(root)}["${mermaidSafeLabel(root)}"]`,
      ];
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
        lines.push(`  ${mermaidNodeId(c)}["${mermaidSafeLabel(c)}"]`);
        lines.push(`  ${mermaidNodeId(root)} --> ${mermaidNodeId(c)}`);
      }
      if (lines.length >= 4) {
        return `Architecture from the attached file tree:\n\n\`\`\`mermaid\n${lines.join("\n")}\n\`\`\``;
      }
    }
  }
  return documentStructureFlow(files);
}

/** Interview Q&A from zip tree / file names when the LLM cannot run. */
export function looksLikeResumeDoc(files: NamedDoc[]): boolean {
  const blob = files.map((f) => `${f.name}\n${f.text || ""}`).join("\n").toLowerCase();
  if (/\b(resume|curriculum\s+vitae|\bcv\b)\b/.test(blob)) return true;
  const hits = [/work\s+experience/, /professional\s+experience/, /\beducation\b/, /\bskills\b/, /\bprojects?\b/].filter((re) =>
    re.test(blob),
  ).length;
  return hits >= 2;
}

/** Résumé-grounded interview questions from extracted sections (not a zip tree template). */
export function extractiveResumeInterviewQuestions(files: NamedDoc[]): string {
  const usable = files.filter((f) => String(f.text || "").trim());
  const raw = usable.map((f) => f.text).join("\n");
  const cite = usable[0]?.name ? ` [${usable[0].name}]` : "";
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 3 && l.length < 220);

  const skillsLine =
    lines.find((l) => /^(skills|technical skills|technologies|tech stack)\b/i.test(l)) ||
    lines.find((l) => /\b(python|javascript|typescript|java|react|sql|aws|docker)\b/i.test(l) && /[,|:|]/.test(l));
  const education = lines.find((l) => /\b(bachelor|master|b\.?s\.?|m\.?s\.?|b\.?tech|university|college)\b/i.test(l));
  const roleLines = lines
    .filter((l) =>
      /\b(engineer|developer|analyst|intern|manager|designer|scientist|consultant|founder)\b/i.test(l),
    )
    .slice(0, 6);
  const companies = [
    ...new Set(
      lines
        .flatMap((l) => {
          const m = l.match(
            /\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,40})|\b([A-Z][A-Za-z0-9&.\- ]{1,40})\s*[—\-–|]\s*(?:software|data|product|engineer)/,
          );
          return m ? [String(m[1] || m[2] || "").trim()] : [];
        })
        .filter((c) => c.length >= 2 && !/^(experience|education|skills|projects)$/i.test(c)),
    ),
  ].slice(0, 4);
  const projectish = lines
    .filter((l) => /\b(built|developed|designed|implemented|led|created|deployed)\b/i.test(l))
    .slice(0, 5);

  const qs: string[] = [];
  if (roleLines[0]) {
    qs.push(`Walk me through your most recent role${cite} — starting from “${roleLines[0].slice(0, 90)}${roleLines[0].length > 90 ? "…" : ""}”. What did you own day to day?`);
  } else {
    qs.push(`Tell me about yourself using this résumé${cite}: what thread connects your roles and projects?`);
  }
  if (companies.length) {
    qs.push(
      `Why did you join ${companies[0]}${companies[1] ? ` (and later ${companies[1]})` : ""}? What problem were you hired to solve?`,
    );
  }
  if (skillsLine) {
    qs.push(
      `You list skills such as “${skillsLine.replace(/^(skills|technical skills|technologies|tech stack)\s*:?\s*/i, "").slice(0, 120)}”. Pick one and go deep: a concrete bug or design trade-off you handled.`,
    );
  } else {
    qs.push(`Which skill on this résumé${cite} would you defend in a technical deep-dive, and what example proves it?`);
  }
  if (projectish[0]) {
    qs.push(`Expand on this bullet: “${projectish[0].slice(0, 110)}${projectish[0].length > 110 ? "…" : ""}”. What was your part vs the team’s?`);
  }
  if (education) {
    qs.push(`How does “${education.slice(0, 100)}${education.length > 100 ? "…" : ""}” show up in the work you do now?`);
  }
  qs.push(`What’s a failure or hard trade-off on this résumé story that taught you something you’d reuse in this role?`);
  qs.push(`If we hired you tomorrow, what from this résumé would you ship in the first 30 days?`);

  const body = qs.slice(0, 7).map((q, i) => `${i + 1}. ${q}`).join("\n\n");
  return `Interview questions a hiring manager could ask based on this résumé${cite}:\n\n${body}`;
}

/** Interview Q&A from zip tree / résumé text when the LLM cannot run. */
export function extractiveInterviewQuestions(files: NamedDoc[]): string {
  if (looksLikeResumeDoc(files)) return extractiveResumeInterviewQuestions(files);

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
    (/folder listing/.test(t) && /agent/.test(t))
  );
}

const FILE_GROUND_STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "from",
  "have",
  "are",
  "was",
  "were",
  "will",
  "your",
  "you",
  "not",
  "but",
  "can",
  "all",
  "any",
  "into",
  "about",
  "what",
  "when",
  "where",
  "which",
  "who",
  "how",
  "does",
  "did",
  "file",
  "files",
  "text",
  "document",
  "summary",
  "overview",
  "please",
  "here",
  "there",
  "they",
  "them",
  "their",
  "been",
  "also",
  "just",
  "like",
  "more",
  "some",
  "than",
  "then",
  "only",
  "other",
  "into",
  "over",
  "such",
  "using",
  "based",
  "according",
]);

function contentTokens(text: string): string[] {
  return (String(text || "").toLowerCase().match(/[a-z][a-z0-9.+_-]{2,}/g) || []).filter(
    (t) => !FILE_GROUND_STOP.has(t) && t.length >= 3,
  );
}

function attachmentNameKeys(files: NamedDoc[]): Set<string> {
  const keys = new Set<string>();
  for (const f of files) {
    const base = String(f.name || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "";
    if (!base) continue;
    keys.add(base.toLowerCase());
    const stem = base.replace(/\.[^.]+$/, "");
    if (stem.length >= 3) keys.add(stem.toLowerCase());
    for (const part of stem.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 4) keys.add(part);
    }
  }
  return keys;
}

/** Reply cites a [name] / filename that is not among the attachments. */
export function replyCitesUnknownFiles(reply: string, files: NamedDoc[]): boolean {
  if (!files.length) return false;
  const known = attachmentNameKeys(files);
  const cited = new Set<string>();
  for (const m of String(reply || "").matchAll(/\[([^\]\n]{2,80})\]/g)) {
    const raw = m[1].trim();
    if (!raw || /^https?:/i.test(raw)) continue;
    if (/^(filename|file|doc|document|source|context)$/i.test(raw)) continue;
    const base = raw.replace(/\\/g, "/").split("/").pop() || raw;
    cited.add(base.toLowerCase());
    cited.add(base.replace(/\.[^.]+$/, "").toLowerCase());
  }
  for (const m of String(reply || "").matchAll(
    /\b([\w.+-]{3,60}\.(?:pdf|docx?|xlsx?|csv|zip|json|md|txt|pptx?))\b/gi,
  )) {
    cited.add(m[1].toLowerCase());
    cited.add(m[1].replace(/\.[^.]+$/, "").toLowerCase());
  }
  if (!cited.size) return false;
  for (const c of cited) {
    if (known.has(c)) continue;
    // Allow partial: "harbour" when attachment is harbour-agent.zip
    let hit = false;
    for (const k of known) {
      if (k.includes(c) || c.includes(k)) {
        hit = true;
        break;
      }
    }
    if (!hit) return true;
  }
  return false;
}

/**
 * Share of reply content-tokens that also appear in attached file text.
 * Low ratio ⇒ model is inventing rather than reading the files.
 */
export function replyFileOverlapRatio(reply: string, files: NamedDoc[]): number {
  const replyToks = contentTokens(reply);
  if (replyToks.length < 8) return 1;
  const fileSet = new Set(
    contentTokens(files.map((f) => `${f.name}\n${f.text || ""}`).join("\n")).slice(0, 8000),
  );
  if (fileSet.size < 12) return 1;
  let hit = 0;
  for (const t of replyToks) {
    if (fileSet.has(t)) hit += 1;
  }
  return hit / replyToks.length;
}

/**
 * Detect clear file-hallucination signals without gating ordinary free-form chat.
 * Stronger models only trip on clear signals; light models also trip on low overlap.
 */
export function looksUngroundedAgainstFiles(
  reply: string,
  files: NamedDoc[],
  ask: string,
  opts?: { lightModel?: boolean },
): boolean {
  const text = String(reply || "").trim();
  if (!text || !files.length) return false;
  if (isMetaAgentNoise(text)) return true;
  if (replyCitesUnknownFiles(text, files)) return true;

  // Invented mermaid when the user did not ask for a diagram (overview early-exit already covers diagram asks).
  if (
    !wantsDiagram(ask) &&
    (/```\s*mermaid\b/i.test(text) || /^\s*flowchart\s+(TB|TD|LR|RL|BT)\b/im.test(text))
  ) {
    return true;
  }

  const fileAsk = asksAboutAttachedFiles(ask);
  if (!fileAsk && !opts?.lightModel) return false;
  if (!fileAsk && opts?.lightModel) {
    // Light model + files present but casual ask: only catch meta/wrong-name/mermaid above.
    return false;
  }

  const overlap = replyFileOverlapRatio(text, files);
  if (opts?.lightModel && text.length > 100 && overlap < 0.14) return true;
  if (text.length > 160 && overlap < 0.06) return true;
  return false;
}

/**
 * Post-reply grounding for attached-file turns.
 * Preserves capable free-form answers; only rescues when the reply is clearly ungrounded.
 */
export function groundAttachedFileReply(
  reply: string,
  files: NamedDoc[],
  ask: string,
  opts?: { lightModel?: boolean },
): string {
  const usable = (files || []).filter((f) => String(f.text || "").trim());
  if (!usable.length) return String(reply || "");
  let out = String(reply || "");

  // Diagram asks should never keep LLM-invented mermaid.
  if (wantsDiagram(ask)) {
    const diagram = architectureFlowFromFiles(usable);
    if (diagram) return diagram;
  }

  if (!looksUngroundedAgainstFiles(out, usable, ask, opts)) return out;

  if (wantsInterviewQuestions(ask)) {
    const qs = extractiveInterviewQuestions(usable);
    if (qs) return qs;
  }
  const fact = extractiveFactAnswer(usable, ask);
  if (fact) return fact;
  const topic = extractiveTopicAnswer(usable, ask);
  if (topic) return topic;
  if (wantsFileOverview(ask) || opts?.lightModel || asksAboutAttachedFiles(ask)) {
    const overview = extractiveFileOverview(usable);
    if (overview) return overview;
  }
  // Stronger model, unclear extractive hit: keep the reply but strip invented mermaid fences.
  if (/```\s*mermaid[\s\S]*?```/i.test(out)) {
    out = out.replace(/```\s*mermaid[\s\S]*?```/gi, "").trim();
  }
  return out;
}

/** Model emitted a safety refusal template. */
export function looksLikeSafetyRefusal(text: string): boolean {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  return (
    /i can'?t (provide|help|assist|offer).{0,80}(illegal|harmful|violent|dangerous|unethical)/i.test(t) ||
    /i cannot (provide|help|assist|offer).{0,80}(illegal|harmful|violent|dangerous)/i.test(t) ||
    /won'?t (help|assist|provide).{0,60}(harm|violence|illegal|crime)/i.test(t) ||
    (/violent acts against/.test(t) && /(can'?t|cannot|won't|will not)/.test(t))
  );
}

/** User ask is clearly requesting violent / serious illegal harm. */
export function looksLikeHarmfulAsk(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (
    /\b(kill|murder|assassinate|strangle|stab|shoot)\b.{0,40}\b(someone|somebody|him|her|them|people|person)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(hit|run over|ram)\b.{0,30}\b(someone|somebody|him|her|them|people)\b.{0,20}\b(car|truck|vehicle)\b/.test(t)) {
    return true;
  }
  if (/\b(with (a |the )?(car|truck|vehicle))\b.{0,20}\b(hit|kill|hurt)\b/.test(t)) return true;
  if (/\b(how (can|do) i )?(make|build|create)\b.{0,20}\b(bomb|explosive|poison)\b/.test(t)) return true;
  if (/\b(hurt|harm|attack|assault)\b.{0,20}\b(someone|somebody|people|him|her|them)\b/.test(t)) return true;
  return false;
}

/**
 * Tiny instruct models often reuse a prior refusal on the next benign turn
 * (“how can I be a millionaire?” → same violent-crime refusal).
 */
export function isOverRefusal(reply: string, ask: string): boolean {
  return looksLikeSafetyRefusal(reply) && !looksLikeHarmfulAsk(ask);
}

/** Soft hedge: refuses to answer but never delivers tips (common on 1B finance asks). */
export function looksLikeSoftHedgeRefusal(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  const low = t.toLowerCase();
  const hedges =
    /i cannot provide (financial|legal|medical|investment|tax) advice/i.test(low) ||
    /i can'?t provide (financial|legal|medical|investment|tax) advice/i.test(low) ||
    (/not (a|an) (financial|legal|medical) (advisor|advice)/i.test(low) && /cannot|can'?t|won't/i.test(low));
  const offersButEmpty =
    /offer some general tips|would that help/i.test(low) && !/^[\s\S]{0,120}(\n\s*[-*•]|\n\s*\d+[.)])/m.test(t);
  return hedges || (offersButEmpty && /cannot|can'?t|but i can/i.test(low));
}

export function isShortAffirmation(q: string): boolean {
  return /^(yes|yeah|yep|yup|sure|ok|okay|please|go ahead|do it|y|yes please)\.?$/i.test(q.trim());
}

/** Open advice asks that need a user-supplied source on this local-first product. */
export function wantsOpenAdviceWithoutSource(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t || looksLikeHarmfulAsk(t) || asksAboutAttachedFiles(t)) return false;
  return (
    /\b(millionaire|get rich|make money|earn money|passive income)\b/.test(t) ||
    /\b(invest|investment|stocks?|crypto|bitcoin|mutual funds?|financial (advice|plan|freedom))\b/.test(t) ||
    /\bhow (can|do) i (become|get|be)\b.{0,40}\b(rich|wealthy|millionaire)\b/.test(t) ||
    /\b(legal advice|medical advice|diagnose|prescribe)\b/.test(t)
  );
}

/**
 * Surf is document-local: when the light model has no source, ask for a file/link
 * instead of looping empty hedges or inventing advice.
 */
export function documentFirstRedirect(topicHint?: string): string {
  const topic = topicHint ? topicHint.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  return (
    "Surf is built to answer from **documents on this device** (and optional local Moss notes) — " +
    "not as a general advisor with private cloud knowledge.\n\n" +
    (topic ? `For “${topic}”, I don’t have a trusted source attached yet.\n\n` : "") +
    "To get useful tips I can stand behind:\n" +
    "1. **Attach** a PDF, article export, notes, or checklist (paperclip), **or**\n" +
    "2. **Paste** the article / guide text (or a clear excerpt) here — I’ll **summarize it** and pull practical tips **only from that source**.\n\n" +
    "If you have a link, paste the page text or a saved PDF of it (this local agent does not fetch the live web by itself)."
  );
}

export function needsDocumentFirstRedirect(
  reply: string,
  ask: string,
  opts: { hasFiles: boolean; priorAssistant?: string },
): boolean {
  if (opts.hasFiles || looksLikeHarmfulAsk(ask)) return false;
  if (isOverRefusal(reply, ask) || looksLikeSoftHedgeRefusal(reply)) return true;
  if (isShortAffirmation(ask) && opts.priorAssistant && looksLikeSoftHedgeRefusal(opts.priorAssistant)) {
    return true;
  }
  // Empty “would that help?” with no tips delivered.
  if (/would that help\??\s*$/i.test(reply.trim()) && !/(\n\s*[-*•]|\n\s*\d+[.)])/.test(reply)) {
    return true;
  }
  return false;
}

/** Drop prior assistant refusals from history so they don’t contaminate the next ask. */
export function stripRefusalContamination(turns: Turn[], currentAsk: string): Turn[] {
  if (looksLikeHarmfulAsk(currentAsk)) return turns;
  const out: Turn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const m = turns[i];
    const soft =
      m.role === "assistant" &&
      (looksLikeSafetyRefusal(m.content) || looksLikeSoftHedgeRefusal(m.content));
    if (soft) {
      const prev = turns[i - 1];
      if (prev?.role === "user" && looksLikeHarmfulAsk(prev.content)) {
        if (out.length && out[out.length - 1].role === "user") out.pop();
        continue;
      }
      continue;
    }
    out.push(m);
  }
  return out;
}

export function overRefusalRetryHint(ask: string): string {
  return (
    `The user asked a normal, non-violent question: "${ask.slice(0, 200)}". ` +
    "If you lack a user-attached document for advice topics (money, legal, medical), " +
    "ask them to attach a PDF/notes or paste article text so you can summarize grounded tips. " +
    "Do NOT refuse ordinary questions. Do NOT mention illegal or violent activities " +
    "unless the user literally asked for them. Short Markdown is fine."
  );
}

/** Tiny models sometimes emit the same bullet 4–10 times with tiny wording changes. */
export function looksLikeLoopedSummary(text: string): boolean {
  const bullets = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^([-•*]|\d+[.)])\s+/.test(l))
    .map((l) =>
      l
        .replace(/^([-•*]|\d+[.)])\s+/, "")
        .toLowerCase()
        .replace(/\$[\d.]+/g, "$")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 8)
        .join(" "),
    )
    .filter((k) => k.length > 10);
  if (bullets.length < 4) return false;
  const counts = new Map<string, number>();
  for (const k of bullets) counts.set(k, (counts.get(k) || 0) + 1);
  const max = Math.max(...counts.values());
  // Same soft-key appears 3+ times, or unique keys are < half of bullets.
  return max >= 3 || counts.size <= Math.ceil(bullets.length / 2);
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
  // Never treat résumés / prose PDFs as YAML just because they have "Languages:" lines.
  if (looksLikeResumeOrCv(name, raw)) return null;
  if (/\.(pdf|docx?|md|txt)$/i.test(name) && !/\.(ya?ml|toml|ini|env|conf|cfg)$/i.test(name)) {
    // Extension is a document — only allow env-style KEY=value files misnamed, not Label: prose.
    const envOnly = /^[A-Z][A-Z0-9_]+=\S+/m.test(raw) && (raw.match(/^[A-Z][A-Z0-9_]+=/gm) || []).length >= 3;
    if (!envOnly) return null;
  }
  const isEnv =
    /\.env/i.test(name) ||
    ((raw.match(/^[A-Z][A-Z0-9_]+=\S+/gm) || []).length >= 3 && !raw.trimStart().startsWith("{"));
  const extYaml = /\.(ya?ml|toml|ini|conf|cfg)$/i.test(name);
  // Content heuristic: many short key: value lines, little long prose (résumés fail this).
  const keyLines = (raw.match(/^[A-Za-z_][\w.-]*:\s*\S+/gm) || []).length;
  const longProse = (raw.match(/[A-Za-z][^.\n]{80,}/g) || []).length;
  const isYaml = extYaml || (keyLines >= 5 && longProse < 3 && !raw.includes("function ") && !raw.trimStart().startsWith("{"));
  if (!isEnv && !isYaml) return null;
  if (isEnv && !extYaml) {
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
  const keys = [...new Set([...raw.matchAll(/^([A-Za-z_][\w.-]*)\s*:/gm)].map((m) => m[1]))].slice(0, 14);
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

/** Receipt / order PDF — list each purchase once (tiny models love to loop line items). */
function explainReceiptOrInvoice(name: string, raw: string): string | null {
  if (!/receipt|invoice|order\s*#|namecheap|sub\s*total|transaction\s*id/i.test(raw + " " + name)) return null;
  if (!/purchase|register|qty|subtotal|total|duration|price/i.test(raw)) return null;

  const order =
    raw.match(/Order\s*(?:Number|#)\s*[:#]?\s*([A-Za-z0-9-]+)/i)?.[1] ||
    raw.match(/Order\s*#\s*([A-Za-z0-9-]+)/i)?.[1] ||
    "";
  const date = raw.match(/Order\s*Date\s*:\s*([^\n]+)/i)?.[1]?.trim() || "";
  const total =
    raw.match(/\bTOTAL\s*\$?\s*([\d.,]+)/i)?.[1] ||
    raw.match(/Final\s*Cost\s*:\s*\$?\s*([\d.,]+)/i)?.[1] ||
    "";
  const user = raw.match(/User\s*Name\s*:\s*([^\n]+)/i)?.[1]?.trim() || "";

  const itemLines = [
    ...raw.matchAll(
      /^(?:PURCHASE|REGISTER|RENEW|TRANSFER)\s+([^\n]+?)(?:\s+(\d+)\s+(?:\d+\s+)?(?:year|month|day)s?\s+\$[\d.]+)?/gim,
    ),
  ];
  const items: string[] = [];
  const seen = new Set<string>();
  for (const m of itemLines) {
    const label = `${m[0]}`.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = label.toLowerCase().replace(/\$[\d.]+/g, "").replace(/\s+/g, " ");
    if (seen.has(key) || key.length < 8) continue;
    seen.add(key);
    items.push(label);
  }
  // Fallback: lines that start with PURCHASE / REGISTER
  if (!items.length) {
    for (const ln of raw.split(/\r?\n/)) {
      const t = ln.replace(/\s+/g, " ").trim();
      if (!/^(PURCHASE|REGISTER|RENEW)\b/i.test(t)) continue;
      const key = t.toLowerCase().replace(/\$[\d.]+/g, "").slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(t.slice(0, 120));
    }
  }

  const lines = [
    `This is a **purchase receipt / order confirmation** **[${name}]**.`,
    `- **Purpose:** proof of what was bought, when, and for how much — not a product manual.`,
  ];
  if (order) lines.push(`- **Order #** ${order}${date ? ` · **Date** ${date}` : ""}.`);
  if (user) lines.push(`- **Account** ${user}.`);
  if (items.length) {
    lines.push(`- **Line items** (${items.length} unique — listed once):`);
    for (const it of items.slice(0, 10)) lines.push(`  - ${it}`);
  }
  if (total) lines.push(`- **Total** $${total.replace(/^\$/, "")}.`);
  if (/FAILED|trial limit/i.test(raw)) {
    lines.push(`- **Note:** at least one line shows a **failed / trial-limit** attempt (not a successful charge for that row).`);
  }
  lines.push(`Ask for one item (e.g. the domain or SSL) if you want that row explained.`);
  return lines.join("\n");
}

/** Soft fingerprint so near-copies of the same fact collapse together. */
function softFactKey(text: string, tokenCap = 10): string {
  return text
    .toLowerCase()
    .replace(/\$[\d.]+/g, "$")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, tokenCap)
    .join(" ");
}

/** Collapse near-duplicate bullets tiny models often emit. */
export function collapseDuplicateBullets(text: string): string {
  const lines = String(text || "").split("\n");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const t = line.trim();
    const bullet = t.match(/^([-•*]|\d+[.)])\s+(.*)$/);
    if (!bullet) {
      out.push(line);
      continue;
    }
    const key = softFactKey(bullet[2], 10);
    if (key.length > 12 && seen.has(key)) continue;
    if (key.length > 12) seen.add(key);
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Collapse near-duplicate plain sentences / paragraphs (non-bullet loops). */
export function collapseDuplicateSentences(text: string): string {
  const parts = String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return String(text || "").trim();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const key = softFactKey(p, 12);
    if (key.length > 16 && seen.has(key)) continue;
    if (key.length > 16) seen.add(key);
    out.push(p);
  }
  // Keep original line structure when we did not find sentence loops.
  if (out.length >= parts.length - 1) return String(text || "").trim();
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/** Cap remaining bullets after soft-dedupe (second fixed iteration). */
function hardCapBullets(text: string, max = 8): string {
  const lines = String(text || "").split("\n");
  const out: string[] = [];
  let bullets = 0;
  for (const line of lines) {
    if (/^\s*([-•*]|\d+[.)])\s+/.test(line)) {
      if (bullets >= max) continue;
      bullets += 1;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Fixed pipeline for light-model loop / pad replies (any file type).
 * Pass 1: soft-dedupe bullets + sentences.
 * Pass 2: if still looped and overview ask + files → extractive rescue.
 * Pass 3: hard-cap to 8 unique bullets.
 */
export function repairLoopedReply(
  text: string,
  opts?: {
    files?: NamedDoc[];
    preferExtractiveOverview?: boolean;
  },
): string {
  let out = collapseDuplicateBullets(String(text || ""));
  out = collapseDuplicateSentences(out);
  if (!looksLikeLoopedSummary(out)) return out;

  if (opts?.preferExtractiveOverview && opts.files?.length) {
    const rescue = extractiveFileOverview(opts.files);
    if (rescue) return rescue;
  }
  return hardCapBullets(collapseDuplicateBullets(out), 8);
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

  if (
    /linkedin|outreach|connection message|talent acquisition|recruiter/i.test(raw) &&
    /hi[, ]/i.test(raw) &&
    !looksLikeResumeDoc([{ name, text: raw }])
  ) {
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
 * Rich offline summary for unpacked zip / project trees.
 * Lists real folders and key files — never the empty “folders exist to separate code” stub.
 */
export function explainZipProject(name: string, raw: string): string {
  const paths = pathsFromFiles([{ name, text: raw }]);
  const root =
    paths.map((p) => p.split("/")[0]).find((r) => r && !/\./.test(r)) ||
    paths[0]?.split("/")[0] ||
    name.replace(/\.zip$/i, "");

  const topFolders = new Map<string, number>();
  const topFiles: string[] = [];
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    if (!parts.length) continue;
    if (parts.length === 1 && /\.[A-Za-z0-9]+$/.test(parts[0])) {
      topFiles.push(parts[0]);
      continue;
    }
    if (parts[0] === root && parts.length >= 2) {
      const second = parts[1];
      if (/\.[A-Za-z0-9]+$/.test(second) && parts.length === 2) {
        topFiles.push(`${root}/${second}`);
      } else {
        topFolders.set(second, (topFolders.get(second) || 0) + 1);
      }
    } else if (parts[0] !== root) {
      topFolders.set(parts[0], (topFolders.get(parts[0]) || 0) + 1);
    }
  }

  const folderList = [...topFolders.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([folder, n]) => `\`${folder}/\`` + (n > 1 ? ` (${n} paths)` : ""));

  const keyNames = paths.filter((p) =>
    /(?:^|\/)(readme(?:\.\w+)?|package\.json|pyproject\.toml|cargo\.toml|go\.mod|dockerfile|makefile|requirements\.txt|setup\.py|main\.(py|ts|js|go)|app\.(py|ts|js|tsx)|index\.(ts|tsx|js|jsx)|start\.(sh|command|bat)|local-agent\.html)$/i.test(
      p,
    ),
  );
  const uniqKeys = [...new Set(keyNames)].slice(0, 10);

  // Pull short excerpts from --- path --- blocks when present
  const excerpts: string[] = [];
  const blockRe = /---\s+([^\n]+)\s+---\n([\s\S]*?)(?=\n---\s+[^\n]+\s+---|\n*$)/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(raw)) && excerpts.length < 4) {
    const path = bm[1].trim();
    const body = bm[2].trim().replace(/\s+/g, " ").slice(0, 140);
    if (!body || body.length < 20) continue;
    if (/^(extracted zip|file tree)/i.test(path)) continue;
    excerpts.push(`\`${path}\`: “${body}${body.length >= 140 ? "…" : ""}”`);
  }

  const lines: string[] = [
    `**[${name}]** is an unpacked project zip` + (root ? ` (root \`${root}\`)` : "") + `.`,
    `- **What it is:** a code/project archive — the file tree and excerpts below are the contents, not a dump of every byte.`,
  ];
  if (folderList.length) {
    lines.push(`- **Top folders:** ${folderList.join(", ")}.`);
  }
  if (topFiles.length) {
    lines.push(
      `- **Top-level files:** ${[...new Set(topFiles)]
        .slice(0, 8)
        .map((f) => `\`${f}\``)
        .join(", ")}.`,
    );
  }
  if (uniqKeys.length) {
    lines.push(`- **Key entry files:** ${uniqKeys.map((p) => `\`${p}\``).join(", ")}.`);
  }
  if (paths.length) {
    lines.push(
      `- **Sample paths (${Math.min(paths.length, 12)} of ${paths.length}):** ${paths
        .slice(0, 12)
        .map((p) => `\`${p}\``)
        .join(", ")}.`,
    );
  } else if (/Extracted zip|File tree/i.test(raw)) {
    lines.push(
      `- Zip header is present but no file paths were found in the extract text. Remove the zip chip and attach it again so the archive can be unpacked.`,
    );
  } else {
    lines.push(`- The attachment says it is a zip extract, but no file paths were parsed — re-attach the zip.`);
  }
  if (excerpts.length) {
    lines.push(`- **From file excerpts:**`);
    for (const e of excerpts) lines.push(`  - ${e}`);
  }
  lines.push(`Ask about one folder or file (e.g. what \`src\` does) for a deeper walkthrough.`);
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
  if (/Extracted zip|File tree/i.test(raw) || /\.zip$/i.test(f.name)) {
    return explainZipProject(f.name, raw);
  }

  if (/\.json$/i.test(f.name) || raw.trimStart().startsWith("{") || raw.trimStart().startsWith("[")) {
    const explained = explainGenericJson(f.name, raw);
    if (explained) return explained;
  }

  const receipt = explainReceiptOrInvoice(f.name, raw);
  if (receipt) return receipt;

  // Résumé / CV before YAML heuristic (Languages: / Databases: look like keys).
  if (looksLikeResumeOrCv(f.name, raw)) {
    return explainMarkdownOrProse(f.name, raw);
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
  return collapseDuplicateBullets(usable.map(explainOneFile).join("\n\n"));
}

const OVERVIEW_OVERRIDE =
  "OVERRIDE: The user wants UNDERSTANDING, not a file dump. " +
  "Explain what this file is for and why key fields, scripts, sections, or symbols are present — like a teacher. " +
  "Use short bullets. Cite [filename]. Do NOT paste JSON, code, or the whole document. " +
  "List each unique fact or line item ONCE — never repeat the same bullet with slight wording changes. " +
  "Prefer at most 8 short bullets. " +
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

/** Word tokens for fuzzy intent matching. */
function askTokens(t: string): string[] {
  return t
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((w) => w.length > 0);
}

/**
 * True if haystack contains target or a near-miss (typo / stem).
 * Lets “interviewer”, “interveiw”, “queston” still fire the right intent.
 */
export function fuzzyHasIntentWord(haystack: string, target: string): boolean {
  const needle = target.toLowerCase();
  const hay = haystack.toLowerCase();
  if (!needle) return false;
  if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(hay)) return true;
  const words = askTokens(hay);
  for (const w of words) {
    if (w === needle) return true;
    // stems: interview ↔ interviewer / interviewing
    if (needle.length >= 5 && w.length >= 5) {
      const a = needle.slice(0, 6);
      const b = w.slice(0, 6);
      if (a === b || editDistance1(a, b)) return true;
    }
    if (w.length >= 4 && needle.length >= 4 && editDistance1(w, needle)) return true;
    if (w.length >= 5 && needle.length >= 5 && (w.startsWith(needle.slice(0, 5)) || needle.startsWith(w.slice(0, 5)))) {
      return true;
    }
  }
  return false;
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

function fileStemTokens(name: string): string[] {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const stem = base.replace(/\.[^.]+$/, "");
  return stem
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length >= 3 &&
        !/^(pdf|txt|doc|docx|zip|json|md|csv|xls|xlsx|pptx|file|the|and|for)$/.test(w),
    );
}

/** Attachments whose basename tokens appear in the user ask (e.g. "harbour" → harbour-agent.zip). */
export function filesNamedInAsk(files: NamedDoc[], query: string): NamedDoc[] {
  const q = String(query || "").toLowerCase();
  if (!q || !files.length) return [];
  return files.filter((f) => {
    const tokens = fileStemTokens(f.name);
    if (!tokens.length) return false;
    const full = (String(f.name).split(/[/\\]/).pop() || "").toLowerCase();
    const stem = full.replace(/\.[^.]+$/, "");
    if (stem.length >= 5 && q.includes(stem)) return true;
    return tokens.some((t) => (t.length >= 4 ? q.includes(t) : new RegExp(`\\b${t}\\b`).test(q)));
  });
}

function scoreChunk(chunk: string, name: string, query: string, index: number): number {
  const q = query.toLowerCase();
  const body = `${name} ${chunk}`.toLowerCase();
  const bodyWords = body.split(/\W+/).filter((w) => w.length > 2);
  const words = queryTerms(query);
  let s = 0;
  if (index === 0) s += 12;
  if (index === 1) s += 6;
  const named = filesNamedInAsk([{ name, text: chunk }], query).length > 0;
  if (named) s += 80;
  if (/\b(about|summar|overview|what is this|this file|tell me|consist|explain)\b/.test(q)) {
    if (index === 0) s += named ? 40 : 20;
    if (index === 1) s += named ? 18 : 8;
  }
  for (const w of words) {
    if (name.toLowerCase().includes(w)) s += 18;
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
  const t = normalizeUserAsk(q).toLowerCase();
  if (!t) return false;
  const hasQ =
    fuzzyHasIntentWord(t, "question") ||
    fuzzyHasIntentWord(t, "questions") ||
    /\b(q&a|q\/a|\bqs\b)\b/.test(t);
  const hasIv =
    fuzzyHasIntentWord(t, "interview") ||
    fuzzyHasIntentWord(t, "interviewer") ||
    fuzzyHasIntentWord(t, "interviewing");
  const hasResume =
    fuzzyHasIntentWord(t, "resume") || fuzzyHasIntentWord(t, "curriculum") || /\bcv\b/.test(t);
  if (/\binterview questions?\b/.test(t)) return true;
  if (hasQ && hasIv) return true;
  if (hasQ && hasResume) return true;
  // “what could they ask / questions to ask me”
  if (hasQ && /\b(could|would|might|should|can|to)\b/.test(t) && /\bask\b/.test(t)) return true;
  if (hasIv && /\b(prep|prepare|practice|mock|drill)\b/.test(t)) return true;
  return /\b(prep(are)? me for (an )?interview|ask me (interview )?questions)\b/.test(t);
}

const STUB =
  /no readable text|no text layer|cannot see the pixels|stored locally|looks binary so no text|could not be read|PDF engine failed/i;

const IMAGE_STUB = /^Image\s+"/i;
const NO_VISION = /cannot see the pixels/i;

/** Fix typos, rough grammar, and near-misses so intent detectors see what the user meant. */
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
    [/\bwat\b/gi, "what"],
    [/\bwot\b/gi, "what"],
    [/\bimgae\b/gi, "image"],
    [/\bimg\b/gi, "image"],
    [/\b(pciture|pictuer|picure)\b/gi, "picture"],
    [/\bscrenshot\b/gi, "screenshot"],
    [/\bscreenshit\b/gi, "screenshot"],
    [/\bresumae?\b/gi, "resume"],
    [/\bresum\b/gi, "resume"],
    [/\bcv\b/gi, "resume"],
    [/\binterveiw(er|ing|s)?\b/gi, "interview$1"],
    [/\binterviewr\b/gi, "interviewer"],
    [/\bintervier\b/gi, "interviewer"],
    [/\bintervewer\b/gi, "interviewer"],
    [/\binterviwer\b/gi, "interviewer"],
    [/\bquestons?\b/gi, "questions"],
    [/\bquesitons?\b/gi, "questions"],
    [/\bqustions?\b/gi, "questions"],
    [/\bquesion(s)?\b/gi, "question$1"],
    [/\bdiagramm?\b/gi, "diagram"],
    [/\bvisuali[sz]eing\b/gi, "visualizing"],
    [/\babot\b/gi, "about"],
    [/\babotu\b/gi, "about"],
    [/\babt\b/gi, "about"],
    [/\bbout\b/gi, "about"],
    [/\bexplian\b/gi, "explain"],
    [/\bsummari[sz]e?\b/gi, "summarize"],
    [/\bsumary\b/gi, "summary"],
    [/\bbreifly\b/gi, "briefly"],
    [/\bbreif\b/gi, "brief"],
    [/\bbased of\b/gi, "based on"],
    [/\bbase on\b/gi, "based on"],
    [/\bbased from\b/gi, "based on"],
    [/\bacording to\b/gi, "according to"],
    [/\bpls\b/gi, "please"],
    [/\bplz\b/gi, "please"],
    [/\bu\b/gi, "you"],
    [/\bur\b/gi, "your"],
  ];
  for (const [re, to] of fixes) t = t.replace(re, to);
  // Broken doubles: "could an interviewer could ask" → "could an interviewer ask"
  t = t.replace(/\b(could|would|should|might|can)\s+(an?\s+\w+)\s+\1\b/gi, "$1 $2");
  t = t.replace(/\b(could|would|should|might|can)\s+\1\b/gi, "$1");
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

/** Greetings / small talk — must not trigger file-unread stubs or force file context. */
export function isCasualGeneralAsk(q: string): boolean {
  const t = q.trim().toLowerCase().replace(/[!?.]+$/g, "").trim();
  if (!t || asksAboutAttachedFiles(t)) return false;
  if (/^(hey|hi|hello|yo|sup|hiya|hola)\b/.test(t)) return true;
  if (
    /^(how are you|how'?s it going|what'?s up|wassup|good (morning|afternoon|evening)|thanks|thank you|ok|okay|bye|goodbye)\b/.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

/** True when the user is clearly asking about attachments / this document. */
export function asksAboutAttachedFiles(q: string): boolean {
  const t = normalizeUserAsk(q).toLowerCase();
  if (!t) return false;
  if (
    wantsFileOverview(t) ||
    wantsShortFact(t) ||
    wantsDiagram(t) ||
    wantsFileConvert(t) ||
    wantsInterviewQuestions(t)
  ) {
    return true;
  }
  if (
    /\b(this|the|my|our)\s+(file|pdf|doc|document|image|picture|screenshot|photo|zip|resume|cv|sheet|spreadsheet|attachment)\b/.test(
      t,
    )
  ) {
    return true;
  }
  if (/\b(attach(?:ed|ment)?|uploaded|in the file|from the file|in this (pdf|doc|image))\b/.test(t)) {
    return true;
  }
  if (fuzzyHasIntentWord(t, "resume") || fuzzyHasIntentWord(t, "document") || fuzzyHasIntentWord(t, "attachment")) {
    return true;
  }
  return false;
}

export function thinAttachmentReply(files: NamedDoc[], query = ""): string | null {
  // No attachments → never a “could not read file” path (general chat must work).
  if (!files.length) return null;

  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) {
    // Unreadable chip on the chat must not block greetings / general questions.
    if (!asksAboutAttachedFiles(query)) return null;
    return "This file is on the chat, but I could not read any text from it. If it is an image, I cannot see pixels — try a clearer filename or paste the text you care about. If it is a scanned PDF, attach a text-based PDF or Word export.";
  }

  if (usable.every((f) => isImageAttachment(f))) {
    // Image stubs: only force the image reply when the user is asking about the image/file.
    if (!asksAboutAttachedFiles(query)) return null;
    return imageExpertReply(usable, query);
  }

  // Mixed: answer images separately only when every non-empty file is an image stub — else continue.
  const body = usable.map((f) => String(f.text || "")).join("\n");
  const letters = (body.match(/[A-Za-z]/g) || []).length;
  const pdfLike = usable.some((f) => /\.pdf$/i.test(f.name) || /PDF|no text layer|scanned/i.test(f.text || ""));

  // Don't use image-pixel stubs as PDF résumé copy when a real image is mixed in.
  const onlyImageNoise = usable.every((f) => isImageAttachment(f) || !String(f.text || "").trim());
  if (onlyImageNoise) {
    if (!asksAboutAttachedFiles(query)) return null;
    return imageExpertReply(usable.filter((f) => isImageAttachment(f)), query);
  }

  if (STUB.test(body) && letters < 240 && !usable.some((f) => isImageAttachment(f))) {
    if (!asksAboutAttachedFiles(query)) return null;
    if (pdfLike) {
      return "I could not read enough text from this PDF (it may be a scan or image-only export). Attach a text-based PDF, Word, or Docs print-to-PDF, then ask again.";
    }
    return "I could not read enough usable text from this file. Attach a text-based copy (PDF with a text layer, Word, or plain text), or paste the part you care about.";
  }
  if (letters < 90 && !usable.some((f) => isImageAttachment(f))) {
    if (!asksAboutAttachedFiles(query)) return null;
    return "I only got a few words from this file, not enough to answer honestly. Attach a text-based copy or paste the relevant text.";
  }
  return null;
}

export function retrieveFileContext(files: NamedDoc[], query: string, budget: number): string {
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const named = filesNamedInAsk(usable, query);
  const focus = named.length ? named : usable;
  const focusNote = named.length
    ? `FOCUS: The user named specific file(s): ${named.map((f) => f.name).join(", ")}. Answer from those file(s) only. Do not dump unrelated attachments.\n\n`
    : "";
  const heads = () =>
    focus.map((f) => `### ${f.name}\n${f.text.slice(0, Math.min(budget, 18000))}`).join("\n\n");
  if (wantsShortFact(query)) {
    const slice = Math.min(budget, 2200);
    return (
      focusNote +
      "OVERRIDE: ONE short fact only (age, email, phone, name, title…). " +
      "Reply like a human expert in one short line. Cite [filename]. Do not paste the file. " +
      "If missing, say it is not in the file.\n\n" +
      heads().slice(0, slice)
    );
  }
  if (wantsInterviewQuestions(query)) {
    return (
      focusNote +
      "OVERRIDE: INTERVIEW QUESTIONS as a hiring expert who read these files. " +
      "Write only numbered interview Q&A grounded in the files. Number 1, 2, 3 in order. " +
      "Do not force a project template.\n\n" +
      heads().slice(0, budget)
    );
  }
  if (wantsDiagram(query)) {
    return (
      focusNote +
      "OVERRIDE: ARCHITECTURE / FLOW DIAGRAM as an expert on this codebase. " +
      "Short intro, then mermaid flowchart TB with real folder or module names. " +
      "Do not dump the raw file tree as the whole answer.\n\n" +
      heads().slice(0, budget)
    );
  }
  if (wantsFileOverview(query)) {
    return focusNote + OVERVIEW_OVERRIDE + heads().slice(0, budget);
  }
  const ranked: Array<{ name: string; text: string; s: number; i: number }> = [];
  for (const f of focus) {
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
    const head = focus
      .map((f) => `### ${f.name}\n${f.text.slice(0, Math.floor(budget / focus.length))}`)
      .join("\n\n");
    return focusNote + head.slice(0, budget);
  }
  return focusNote + FILE_GROUND + parts.join("\n\n");
}

/** Pull the most relevant lines for a free-form ask (offline / light-model fallback). */
export function extractiveTopicAnswer(files: NamedDoc[], query: string): string | null {
  const usable = files.filter((f) => String(f.text || "").trim());
  if (!usable.length) return null;
  const q = query.trim();
  if (!q) return null;
  // Prefer company experience when the ask mentions a workplace.
  const cite = usable[0]?.name ? ` [${usable[0].name}]` : "";
  const blob = usable.map((f) => String(f.text || "")).join("\n");
  if (/\b(experience|exp\.?|worked|tenure|role|job)\b/i.test(q)) {
    const company = extractCompanyExperience(blob, q, cite);
    if (company) return company;
  }
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "at",
    "for",
    "is",
    "are",
    "was",
    "were",
    "this",
    "that",
    "with",
    "from",
    "how",
    "much",
    "does",
    "did",
    "have",
    "has",
    "please",
    "just",
    "what",
    "who",
    "when",
    "where",
    "why",
    "about",
    "person",
    "candidate",
    "file",
    "document",
  ]);
  const terms = q
    .toLowerCase()
    .replace(/[^a-z0-9+.\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !stop.has(t));
  if (!terms.length) return null;
  const scored: Array<{ line: string; s: number }> = [];
  for (const f of usable) {
    for (const line of String(f.text || "").split(/\r?\n/)) {
      const t = line.replace(/\s+/g, " ").trim();
      if (t.length < 8 || t.length > 220) continue;
      const low = t.toLowerCase();
      let s = 0;
      for (const term of terms) {
        if (low.includes(term)) s += term.length > 4 ? 3 : 1;
      }
      if (s > 0) scored.push({ line: t, s });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    const key = softFactKey(row.line, 12);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(row.line);
    if (uniq.length >= 4) break;
  }
  if (!uniq.length) return null;
  return (
    `From the attached file${cite}:\n` +
    uniq.map((l) => `- ${l}`).join("\n") +
    `\n(Ask a narrower question if you want one field only.)`
  );
}

/** Fallback when the in-browser model cannot run — answer the ask, never mislabel the file. */
export function offlineFileBrief(files: NamedDoc[], query: string, reason: "offline" | "no-model" = "offline"): string {
  void reason;
  const usable = files.filter((f) => (f.text || "").trim());
  if (!usable.length) return "";
  const q = query.trim() || "What is in these files?";
  const named = filesNamedInAsk(usable, q);
  const focus = named.length ? named : usable;

  const fact = extractiveFactAnswer(focus, q);
  if (fact) return fact;

  if (wantsDiagram(q)) {
    const diagram = architectureFlowFromFiles(focus);
    if (diagram) return diagram;
  }
  if (wantsInterviewQuestions(q)) {
    return extractiveInterviewQuestions(focus);
  }

  // Overview / explain only when the user actually asked for that.
  if (wantsFileOverview(q)) {
    const overview = extractiveFileOverview(focus);
    if (overview) return overview;
  }

  const topic = extractiveTopicAnswer(focus, q);
  if (topic) return topic;

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

/**
 * Turn-level context injection (no fine-tuning / no per-task training).
 * Right approach for Surf: steer the base model with this turn’s facts only.
 * - General chat: inject an explicit “no files needed” cue so first-time asks work.
 * - File chat: inject attachments as the source of truth.
 * - Memory / Moss: optional extras, never required to start.
 */
export function generalTurnCue(): string {
  return (
    "TURN CONTEXT: No files are attached on this turn. " +
    "Answer as a general helpful assistant. The user does not need to upload anything or train you. " +
    "Infer what they mean even if spelling or grammar is rough. Use the conversation so far if present. Be clear and concise."
  );
}

export function fileTurnCue(): string {
  return (
    "TURN CONTEXT: Attached file text follows. Prefer it for file questions; cite [filename]. " +
    "Infer the user’s real intent even when wording is messy or misspelled. " +
    "Do not invent facts, filenames, paths, or diagrams missing from the attachments. " +
    "If the answer is not in the attached text, say you do not see it there — do not guess."
  );
}

function extraLooksLikeFiles(extra: string): boolean {
  return /\b(### |Attached files|Attached local files|OVERRIDE:|File tree|Extracted zip|TURN CONTEXT: Attached file)\b/i.test(
    extra,
  );
}

export function groundedSystem(memory: string, extra: string, memoryBudget: number): string {
  const hasFiles = extraLooksLikeFiles(extra);
  const base = hasFiles
    ? "You are Surf AI on this device — a careful document colleague for the attached sources. " +
      "Infer the user’s real intent even when spelling is wrong. " +
      "For explain / what is this / briefly: teach why fields, scripts, and sections exist — never paste the raw file. " +
      "One fact → one short line with [filename]. Do not invent facts, names, or paths missing from CONTEXT. " +
      "If unsure, say it is not in the attached files. Never invent mermaid/diagrams. " +
      "Never summarize your role. Do not mention product internals unless asked."
    : "You are Surf AI on this device — a helpful local assistant. " +
      "First-time users may ask general questions with no files and no prior setup. " +
      "Answer clearly; use Markdown when it helps. " +
      "Refuse only clear violent or seriously illegal harm requests — never refuse ordinary questions " +
      "(money, career, emotions, how-to for legal tasks) and never reuse an earlier refusal on a new ask. " +
      "When attachments or retrieval CONTEXT appear later, prefer those sources. " +
      "Never summarize your role. Do not mention product internals unless asked. " +
      "Do not demand uploads before answering.";

  const parts: string[] = [base];
  if (hasFiles) {
    if (!/TURN CONTEXT: Attached file/i.test(extra)) parts.push(fileTurnCue());
  } else {
    parts.push(generalTurnCue());
  }
  if (extra.trim()) parts.push(extra.trim());
  if (memory.trim()) {
    parts.push(
      "Retained memory notes from older chats on this device (each note is separate; do not mix their files):\n" +
        memory.trim().slice(0, memoryBudget),
    );
  }
  return parts.join("\n\n");
}
