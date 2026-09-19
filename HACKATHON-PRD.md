# Surf AI — Product Requirements Document (Hackathon)

**Product name:** Surf AI  
**Live shell:** https://synap.surf  
**Owner / builder:** Synap (Surf)  
**License:** Synap Developer License (proprietary) — confirm hackathon allows closed source  
**Track fit:** Local-first AI / Small Cloud (YC × Moss style)

**Tagline:** Surf your files locally — answers stay on your device.

---

## 1. Executive summary

Surf AI is a **local-first document chat** product. Users attach PDFs, Word/Excel sheets, slides, text, or zips and ask questions. Answers are produced **on the device** (in-browser WebLLM and/or Ollama), with chats and files stored in **the browser’s IndexedDB**. The public website is a **static shell** that does not keep user chat content as its product database.

Optional **Download zip** runs the same agent offline on a Mac/Windows/Linux computer via a one-line setup script.

---

## 2. Problem

Cloud chatbots force people to upload résumés, banking CSVs, and private folders to someone else’s servers. Local tools (Ollama, RAG stacks) are powerful but hard to set up. Surf closes that gap: **simple browser chat first**, **stronger local zip when they want it**, with an honest privacy story.

---

## 3. Goals

| Goal | Success signal |
|------|----------------|
| Privacy-first answers | Attached file text used for Q&A without a cloud LLM for core chat |
| Low-friction try | Sign in → attach file → ask on synap.surf |
| Offline / desktop path | Zip + `LOCAL-SETUP` opens local agent without Next.js |
| Honest product limits | Light model short answers; conversion not supported; clear copy |
| Hackathon stack lock | Next.js static export; Ollama; Moss when configured; LiveKit loopback optional |

---

## 4. Non-goals (v1 / demo)

- File **conversion** (PDF ↔ DOC, Excel → PDF, etc.) — reply: not supported  
- Claiming phone Terminal / zip setup (phones use browser chat only)  
- Shipping Whisper model weights or SDXL in the UI  
- Cloud OpenAI/Anthropic as the default answer engine  
- Kernel-level network firewall (eBPF/WFP)

---

## 5. Users

1. **Privacy-conscious professionals** — résumés, contracts, spreadsheets stay local.  
2. **Demo / hackathon judges** — attach a sample zip/PDF, ask “what does this include?”  
3. **Desktop power users** — download zip + Ollama for fuller models than in-browser 1B.

---

## 6. User journeys

### 6.1 Try on the website
1. Open synap.surf → Chat (email verify if required).  
2. Attach PDF / DOCX / XLSX / ZIP.  
3. Ask a question or “summarize what this includes.”  
4. Get an answer grounded in extracted file text.  
5. Optional: Save summary / Delete data in this browser.

### 6.2 Run offline on a computer
1. **Download zip** → unpack `local-ai`.  
2. Run `LOCAL-SETUP.sh` / `.bat` (one Terminal line).  
3. Chrome opens `local-agent.html` on `127.0.0.1:18766`.  
4. Chat with WebLLM and/or local Ollama.

### 6.3 Conversion request
1. User asks to convert PDF ↔ Word / export PDF.  
2. Product replies that **conversion is not supported**; reading for Q&A still works.

---

## 7. Functional requirements

### 7.1 Chat & grounding
| ID | Requirement | Acceptance |
|----|-------------|------------|
| FR-1 | Multi-turn chat in browser | Threads persist in IndexedDB after reload |
| FR-2 | Attach documents | PDF, DOCX, XLSX, CSV, PPTX, TXT, MD, ZIP accepted |
| FR-3 | Extract text for RAG-style grounding | Answers cite filenames / real phrases from attachments |
| FR-4 | Overview / summary of attachment | Light models use extractive file brief; not agent-prompt meta |
| FR-5 | Thin / scanned PDF honesty | Clear message when no text layer |
| FR-6 | Conversion asks | Fixed unsupported message; no fake download |

### 7.2 Models & engines
| ID | Requirement | Acceptance |
|----|-------------|------------|
| FR-7 | In-browser light model | WebLLM path when no host (WebGPU Chrome/Edge) |
| FR-8 | Ollama via host | `/v1/health` shows local backend; chat streams |
| FR-9 | Light-model UX | Banner: short answers; point to Download zip |
| FR-10 | No server RAM in public UI | “What’s running” does not show host/VM RAM |

### 7.3 Local zip
| ID | Requirement | Acceptance |
|----|-------------|------------|
| FR-11 | Download pack | Zip includes `local-agent.html`, setup scripts, pdf.js, system.md |
| FR-12 | Mobile honesty | Setup dialog: phones don’t run Terminal setup |

### 7.4 Account & platform (shell)
| ID | Requirement | Acceptance |
|----|-------------|------------|
| FR-13 | Email register / OTP / login | JWT for host routes |
| FR-14 | Human feedback | Thumbs + note stored for builders |
| FR-15 | Optional LiveKit loopback | Token endpoint for local voice path |
| FR-16 | Optional Moss | On-device search when configured; no `push_index` |

### 7.5 Privacy UX
| ID | Requirement | Acceptance |
|----|-------------|------------|
| FR-17 | Storage card | Shows chats/files sizes and browser quota |
| FR-18 | Save summary / erase | Summarize then delete chat text; or wipe all local chat data |

---

## 8. Non-functional requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Static UI | `NEXT_PUBLIC_HOST_URL=… npm run build` → `apps/web/out` |
| NFR-2 | Composer responsiveness | Send handoff under ~100 ms (excluding model latency) |
| NFR-3 | Low-RAM hosts | Prefer `llama3.2:1b` when RAM is tight |
| NFR-4 | No secrets in git | `.env` gitignored; demo uses example values only |
| NFR-5 | MIME-safe PDF engine | `pdf.js` / `pdf.worker.js` served as JavaScript |

---

## 9. Architecture (summary)

See **[HACKATHON-ARCHITECTURE.md](./HACKATHON-ARCHITECTURE.md)** for Mermaid diagrams.

```
Browser UI (Next static)
  ├─ IndexedDB (chats, files, memory)
  ├─ WebLLM (optional in-tab 1B)
  └─ HTTPS → FastAPI host (auth, feedback, /v1/chat)
              └─ Ollama / Moss on same machine or VM
Download zip → Python static server :18766 → same agent offline
```

---

## 10. Tech stack (shipped)

| Layer | Choice |
|-------|--------|
| UI | Next.js App Router, `output: 'export'`, React |
| Browser storage | IndexedDB |
| In-browser LLM | WebLLM (Llama 3.2 1B class) |
| Host | FastAPI + Gunicorn/Uvicorn, SQLite |
| Local LLM | Ollama (`llama3.2:1b` / `3b`, …) |
| Docs | pdf.js, OOXML readers for docx/xlsx/pptx |
| Prompt | `harness/prompts/system.md` + grounded overrides |
| Voice (optional) | LiveKit loopback + browser dictation |
| Search (optional) | Moss SDK / local fallback |

---

## 11. Success metrics (hackathon demo)

1. Judge attaches a sample PDF/zip → gets a **file-grounded** summary (not “document agent job description”).  
2. Judge sees **Download zip** and understands desktop vs phone.  
3. Judge asks to convert PDF → Word → hears **not supported**, still can ask content questions.  
4. Storage card shows data **in this browser**.  
5. Optional: Ollama health + model name visible under “What’s running.”

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| 1B model invents / goes meta | Extractive overview; OVERRIDE prompts; thin-file gates |
| Low VM RAM | Prefer 1B; honest “answers stay short” copy |
| PDF scan / bad MIME | pdf.js as `.js`; clear “no text layer” message |
| Proprietary license vs OSS hackathon | Confirm rules; offer demo URL + private repo access |

---

## 13. Demo script (3 minutes)

1. Open synap.surf/chat — show banner + light model note.  
2. Attach a résumé or sample zip — ask “What does this include?”  
3. Show sidebar: What’s running / What’s saved in this browser.  
4. Ask “Convert this to Word” — show unsupported reply.  
5. Click Download zip — explain offline desktop path.  
6. Close: “Answers stay on the device; the website is only a shell.”

---

## 14. Deliverables checklist

- [x] Live site: synap.surf  
- [x] Architecture diagram: `HACKATHON-ARCHITECTURE.md`  
- [x] This PRD: `HACKATHON-PRD.md`  
- [ ] Pitch slide / video (team)  
- [ ] Sample attachment for judges (team)

---

## 15. Elevator pitch

**Tagline:** Surf your files locally — answers stay on your device.

**One breath:** Surf AI is local-first document chat: attach a PDF, spreadsheet, or zip, ask questions, and get answers from a model on your browser or computer — not from a cloud LLM that keeps your files.

---

## 16. Version

**PRD version:** Hackathon submission — aligned to shipped Surf AI as of Sep 2026  
**Note:** Older `Product-Requirements-Document-PRD-The-Small-Cloud-AI-Agent.md` includes aspirational items (Whisper/SDXL/Playwright/eBPF). Do **not** claim those as built for this demo.
