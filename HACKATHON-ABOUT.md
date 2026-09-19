# About the project — Surf AI

**Tagline:** Surf your files locally — answers stay on your device.

---

## What inspired us

We kept hitting the same trade-off: powerful AI chat is useful for résumés, bank CSVs, and private folders — but almost every tool wants those files in someone else’s cloud. Local stacks (Ollama, RAG, vector DBs) solve privacy, yet they feel like a weekend of Terminal work for a non-engineer.

Surf AI started from a simple bet: **the website should be a shell, not a vault.** Deliver a calm chat UI from the browser; keep chats, attachments, and model inference on the device. If someone wants a stronger offline path, give them a **one-line zip setup** on a real computer — not a fake “local” product that still ships prompts to a frontier API.

The Moss / Small Cloud framing pushed us further: treat “local-first” as a product constraint, not a slide. If we could not point to where the bytes live (IndexedDB, Ollama, optional host SQLite), we did not claim the feature.

---

## How we built it

### Shape of the system

```text
synap.surf (static Next.js export)
        │
        ▼
  Browser agent (React)
   ├─ IndexedDB — threads, files, saved summary
   ├─ WebLLM — in-tab light model (≈ 1B params)
   └─ optional HTTPS → FastAPI host
              └─ Ollama / Moss on the machine
Download zip → Python serves local-agent.html on 127.0.0.1
```

### Stack we actually shipped

| Layer | Choice |
|-------|--------|
| UI | Next.js App Router, `output: 'export'` |
| Storage | Browser IndexedDB for chat + attachments |
| In-browser model | WebLLM (Llama 3.2–class 1B) |
| Desktop / server model | Ollama (`llama3.2:1b`, `3b`, …) |
| Host API | FastAPI — auth, feedback, `/v1/chat` stream |
| Documents | pdf.js + OOXML readers (DOCX / XLSX / PPTX / CSV) |
| Prompting | CRISPE `system.md` + grounded file overrides |
| Offline pack | Zip with `LOCAL-SETUP` + `local-agent.html` |

### Build path in practice

1. **Static shell** — land page + `/chat`, no user chat DB on the CDN.  
2. **Attachment pipeline** — extract text first; only then ask the model.  
3. **Grounding** — `retrieveFileContext` / overview overrides so “what does this include?” means *the file*, not the agent prompt.  
4. **Two runtimes** — browser WebLLM when alone; host + Ollama when available.  
5. **Honest UX** — light-model banner, mobile “no Terminal setup,” conversion explicitly unsupported.  
6. **Deploy** — VM nginx serves `out/`; systemd runs the host; Ollama on the same box for the public demo.

For small models we treated context as a hard budget. If the usable prompt is on the order of a few thousand tokens, stuffing a long system essay plus chat history crowds out the attachment — so we prefer **file-first packs** and, for overview asks on 1B, an **extractive brief** from the file text itself.

Roughly, if prompt size is constrained by a window \(C\) (tokens) and system + history consume \(S\), the attachment budget looks like:

\[
B_{\text{file}} \approx C - S
\]

When \(B_{\text{file}}\) is tiny, a 1B model will invent structure from the system prompt. That math is why we short-circuit some summary questions with text taken straight from the attachment.

---

## What we learned

- **Local-first is a data-plane choice.** “Local” means naming the store: IndexedDB vs host SQLite vs Ollama weights — not vibes.  
- **Extraction beats clever prompting.** Scanned PDFs and wrong MIME types (`pdf.js` served as the wrong type) look like “dumb model” until the text layer is fixed.  
- **Small models need product rails.** `llama3.2:1b` will paraphrase “you are a document agent” unless you OVERRIDE, cut history noise, or answer extractively.  
- **Honesty scales better than fake features.** File conversion, phone Terminal setup, and “this computer’s RAM” on a remote VM all needed clear copy — judges and users trust the product more when limits are named.  
- **Static export + optional host** is a workable Small Cloud pattern: the site can be dumb; the device (or a user’s own host) can be smart.

---

## Challenges we faced

### 1. Grounding failures that looked like hallucinations  
Users asked for a summary of an attached zip/PDF and got a meta essay about the agent’s job. Root cause: light models summarizing instructions and prior chat, not the file. Fix: overview detection, stronger overrides, extractive briefs on 1B, and “conversion not supported” as a hard path instead of a half-broken convert.

### 2. PDF text that “should work” but didn’t  
Hand-rolled PDF scanning and `.mjs` MIME issues on nginx meant empty extracts. Moving to pdf.js as proper `.js` assets unblocked real résumés and docs.

### 3. Demo hardware reality  
A ~\(3.8\,\mathrm{GB}\) RAM VM cannot host a large model and stay snappy. We leaned into `llama3.2:1b`, labeled answers as short, and pointed fuller quality at the desktop zip + larger Ollama tags.

### 4. Product language vs privacy truth  
File conversion and phone Terminal setup needed clear limits. We do not show host/VM RAM in the public UI.

### 5. Mobile vs desktop setup  
The zip path needs Terminal. Phones do not. We taught the Setup dialog and light-model note to say: chat in the browser on mobile; run the command on a computer.

### 6. Scope discipline under hackathon pressure  
It is tempting to claim Whisper, SDXL, browser automation, or kernel firewalls. We kept the demo to what ships: attach → extract → ask → answer on-device, with auth/feedback as the thin platform shell.

---

## Closing

Surf AI is our answer to “can AI help with my files without eating my files?” Inspiration was privacy anxiety and setup fatigue; the build was a static agent + local engines; the hard lessons were grounding, MIME, small-model behavior, and telling the truth in the UI.

**Demo:** [https://synap.surf](https://synap.surf)  
**Architecture:** `HACKATHON-ARCHITECTURE.md`  
**PRD:** `HACKATHON-PRD.md`
