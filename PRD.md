# Product Requirements Document — Surf AI

**Product:** Surf AI (synap.surf)  
**One-liner:** Local-first file chat — your files and answers stay on your laptop.  
**Track:** YC × Moss Local-First / Small Cloud  
**Status:** Shipping (download pack + on-device Ollama)  
**Site:** https://synap.surf  
**Document:** Single PRD + IEEE 830–style requirements (IDs, acceptance, traceability)  
**Version:** 1.1 — 2026-09-22  

---

# Part A — Product narrative

## A1. Problem

Most “AI for your files” products send documents and prompts to a cloud model. That is hard for teams that need:

- **Privacy** — contracts, résumés, payroll, and source trees should not leave the device  
- **Offline / low-trust networks** — no dependency on a SaaS chat API for every answer  
- **Cost control** — no per-token bill for everyday file Q&A  

Non-engineers also struggle with “install Ollama, pull a model, wire a UI.” They need **download → one command → chat in Chrome**.

## A2. Vision

| Layer | Role |
| --- | --- |
| **Website (thin)** | Download pack, account / OTP, feedback only |
| **Laptop (thick)** | Chat UI, Moss text retrieval, Ollama model, chats + files on disk |

**Promise:** Anyone who can unzip a folder and run one command can chat with PDFs, Excel, and zips — **without a cloud API key for chat**.

## A3. Goals

1. Zero chat bodies on the cloud (`platform_bytes = 0` for chat)  
2. One zip, one command (`LOCAL-SETUP` / `SURF-OPEN`)  
3. Grounded answers (named-file focus)  
4. Extractive overview & diagrams when files are attached  
5. Hallucination gate for clear drift (non-breaking for capable free-form chat)  
6. Moss on-device text retrieval  
7. Ship with a harness; scale models via pack settings without redeploying the site  

## A4. Non-goals

- Cloud inference for product chat on synap.surf  
- Phone / tablet Terminal setup as a primary path  
- Treating product README / seed docs as the user’s corpus  
- Replacing a full IDE agent (Cursor-class)  

## A5. Users & jobs

| Persona | Job |
| --- | --- |
| **Non-developer** | Download → run setup → ask about attached PDFs / Excel / zips in Chrome |
| **Engineer** | Editable pack (`agent.json`, harness, prompts); swap or fine-tune Ollama tags |
| **Team / product** | Same UI from 1B laptop models to larger tags without changing the website |

## A6. Happy path

1. Open https://synap.surf/download  
2. Pick RAM tier + model  
3. Account if needed → **Download** pack  
4. Unzip → run **Required** Terminal command  
5. Chrome opens local chat (`:18766`)  
6. Attach files → summary / diagram / follow-ups  
7. Optional: pack harness (`evals` / `custom`)  

## A7. Architecture

```text
synap.surf (download + auth)
        │ zip
        ▼
 LOCAL-SETUP / pack
        │
        ▼
 Chrome :18766  ──►  Ollama (chosen tag)
        │
        ├──► Moss (text retrieval)
        └──► Disk (chats + attachments)
```

```text
Question + files → Sanitize → Named-file / Moss context
  → Overview or diagram? → Extractive reply
  → Else                 → Ollama writes reply → Answer in Chrome
  → (if attached files)  → Grounding gate on clear hallucination signals
```

## A8. Model strategy

| Tier | Examples | Expectation |
| --- | --- | --- |
| Light | Llama 3.2 1B, Qwen 2.5 1.5B | Fast short answers; overview/diagram extractive |
| Everyday | Llama 3.2 3B, Phi-3 Mini | Clearer chat; same extractive overview/diagram with files |
| Strong / workstation | Mistral 7B, Llama 8B+, Qwen 14B+ | Better free-form; pack UI unchanged |

## A9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Small models hallucinate file content | Extractive overview / diagram + grounding gate |
| Wrong attachment in multi-file chats | `filesNamedInAsk` scoping |
| Zip “no paths” | Central-directory unpack |
| Users can’t finish setup | One Required command + clear download dock |
| Cloud creep | `allowInBrowserLlm()` false on synap.surf |

## A10. Open questions

- Which default light model converts best for non-technical users?  
- Fine-tune / custom Ollama tags in download UI vs `agent.json` only?  
- Team / shared vault later — still local-first, or hybrid sync?  

## A11. LinkedIn blurb (optional)

Surf AI is local-first file chat: website downloads the pack; model + Moss run on the laptop; answers stay grounded to named files; summaries/diagrams stay reliable on small models; cloud never sees chat bodies.  
https://synap.surf  

---

# Part B — Formal requirements (IEEE 830–style)

Priority: **M** = Must (shipping), **S** = Should, **C** = Could / future.  
Adopting this section is **documentation only** — it does not by itself change the codebase.

## B1. Definitions

| Term | Meaning |
| --- | --- |
| **Pack** | Downloadable zip with LOCAL-SETUP, chat UI, `agent.json`, harness |
| **Host** | Thin Python service (`:18765`) — auth / OTP / feedback / health |
| **Ollama** | Local model runtime (typically `:11434`) |
| **Moss** | On-device text document retrieval |
| **Extractive** | Answer from file text / tree without trusting the LLM to invent |
| **Light model** | Small local tags (e.g. 1B / 1.5B / 2B) |

## B2. Scope (formal)

**In scope:** download pack, local chat (pack + LocalChat), Ollama, Moss, thin host JWT APIs, harness/gate.  
**Out of scope:** cloud chat LLM on synap.surf, phone-first setup, IDE coding agent, seed README as user corpus.

## B3. Specific requirements

### B3.1 Privacy & platform

| ID | Priority | Requirement (shall) | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-PRIV-001 | M | The platform shall not store chat message bodies as platform data. | Gate: `platform_bytes = 0` for chat platform semantics. |
| REQ-PRIV-002 | M | synap.surf shall not enable WebLLM as the product AI path. | `allowInBrowserLlm()` false on synap.surf hostnames. |
| REQ-PRIV-003 | M | Local LLM URL shall be loopback when a backend is configured. | Gate: `local-llm-loopback`. |
| REQ-PRIV-004 | M | Local LLM URL shall not point at OpenAI/Anthropic SaaS chat. | Gate: `local-llm-not-saas`. |

### B3.2 Authentication & host API

| ID | Priority | Requirement (shall) | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-AUTH-001 | M | Protected host APIs shall require Bearer JWT. | Unauthorized → fail; valid JWT → succeed (`auth.py`). |
| REQ-AUTH-002 | M | Auth-sensitive host endpoints shall be rate-limited. | Over limit → HTTP 429 (`rate_limit.py`). |
| REQ-AUTH-003 | M | Host chat shall be rate-limited per user subject. | `rate_limit(..., chat:{sub})`; 429 when exceeded. |
| REQ-AUTH-004 | C | A local gateway shall auth + rate-limit Ollama (`:11434`). | **Gap today** — see B5. |

### B3.3 Download & pack

| ID | Priority | Requirement (shall) | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-PACK-001 | M | Download shall lock selected model into `agent.json`. | `test_pack_identity.py` |
| REQ-PACK-002 | M | Pack chat shall not require a cloud chat API key. | `test_standalone.py` |
| REQ-PACK-003 | M | Download UI shall show Required + optional harness commands; success note fully visible. | Download dock UX |
| REQ-PACK-004 | S | Pack shall ship a mini harness. | `test_pack_guardrails.py` |

### B3.4 File ingestion & retrieval

| ID | Priority | Requirement (shall) | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-FILE-001 | M | Named file in ask shall prefer that attachment over siblings. | `test_file_focus.py` |
| REQ-FILE-002 | M | ZIPs shall expose real paths via CD-safe unpack. | `test_zip_and_summary.py` |
| REQ-FILE-003 | M | User/attachment text shall be sanitized (injection/secrets). | `test_guardrails.py` |
| REQ-FILE-004 | M | Moss shall retrieve user docs; not product seed README as answers. | `test_moss.py`, `test_moss_pack.py` |
| REQ-FILE-005 | S | Support PDF, DOCX, Excel/CSV, PPTX, text, JSON, zip. | `test_convert.py` + ingest |

### B3.5 Overview, diagrams & hallucination

| ID | Priority | Requirement (shall) | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-OVW-001 | M | Attached-file overview/summary shall be extractive. | `test_diagram_overview.py` |
| REQ-OVW-002 | M | Diagram asks shall build flow from zip tree or sections. | `test_diagram_overview.py` |
| REQ-OVW-003 | M | Clear ungrounded LLM drift on files shall be rescued extractively. | `groundAttachedFileReply` + harness hallucination-gate-* |
| REQ-OVW-004 | M | Grounded free-form chat shall not be forced extractive. | Gate only on clear signals |

### B3.6 Chat quality & UX

| ID | Priority | Requirement (shall) | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-CHAT-001 | M | General chat without files shall work. | `test_general_chat.py` |
| REQ-CHAT-002 | M | Over-refusal / soft hedge on benign asks shall be repaired or document-first. | `test_over_refusal.py`, `test_reply_repair.py` |
| REQ-CHAT-003 | S | Markdown/mermaid shall render as structured UI. | `test_chat_markdown.py` |
| REQ-CHAT-004 | S | Composer layout shall stay stable. | `test_diagram_overview.py` composer checks |

### B3.7 Voice (optional)

| ID | Priority | Requirement (shall) | Acceptance criteria |
| --- | --- | --- | --- |
| REQ-VOICE-001 | C | Voice may use LiveKit on loopback when reachable. | Optional; not required for core file chat |

## B4. Traceability matrix

| Requirement ID | Design / code locus | Verification |
| --- | --- | --- |
| REQ-PRIV-001 | Host privacy / health | `gate.py` → `zero-knowledge-platform-bytes` |
| REQ-PRIV-002 | `browserCaps.ts` | Code review + pack-only AI path |
| REQ-PRIV-003 | `/health` local_llm.url | `gate.py` → `local-llm-loopback` |
| REQ-PRIV-004 | `/health` | `gate.py` → `local-llm-not-saas` |
| REQ-AUTH-001 | `apps/host/auth.py` | Host auth + smoke |
| REQ-AUTH-002 | `apps/host/rate_limit.py` | 429 on auth/track/login |
| REQ-AUTH-003 | `main.py` chat rate_limit | Chat route 429 |
| REQ-AUTH-004 | *(not implemented)* | FUTURE — B5 |
| REQ-PACK-001 | `agent.json` / pack identity | `test_pack_identity.py` |
| REQ-PACK-002 | Standalone pack chat | `test_standalone.py` |
| REQ-PACK-003 | `ChatDownloadShell.tsx` | Manual UX |
| REQ-PACK-004 | Pack harness | `test_pack_guardrails.py` |
| REQ-FILE-001 | `filesNamedInAsk` | `test_file_focus.py` |
| REQ-FILE-002 | zip CD unpack | `test_zip_and_summary.py` |
| REQ-FILE-003 | Guardrails | `test_guardrails.py` |
| REQ-FILE-004 | Moss | `test_moss.py`, `test_moss_pack.py` |
| REQ-FILE-005 | attachments + convert | `test_convert.py` |
| REQ-OVW-001 | `extractiveFileOverview` | `test_diagram_overview.py` |
| REQ-OVW-002 | `architectureFlowFromFiles` | `test_diagram_overview.py` |
| REQ-OVW-003 | `groundAttachedFileReply` | hallucination-gate-* checks |
| REQ-OVW-004 | Same gate (non-breaking) | Review + prompt checks |
| REQ-CHAT-001 | general chat path | `test_general_chat.py` |
| REQ-CHAT-002 | over-refusal / repair | `test_over_refusal.py`, `test_reply_repair.py` |
| REQ-CHAT-003 | MarkdownBody / MermaidFlow | `test_chat_markdown.py` |
| REQ-CHAT-004 | composer CSS | `test_diagram_overview.py` |
| REQ-VOICE-001 | `VoiceRoom.tsx` | Optional health livekit |

**Re-verify**

```bash
./harness/run.sh
python3 harness/evals/test_file_focus.py
python3 harness/evals/test_diagram_overview.py
python3 harness/evals/gate.py   # needs host up for live checks
```

## B5. Known gaps

| Item | Current | Gap |
| --- | --- | --- |
| Host `:18765` | JWT + rate limit | Addressed (REQ-AUTH-001..003) |
| Ollama `:11434` | Often called directly from pack/browser | **REQ-AUTH-004 unmet** |
| Moss bridge CORS | Permissive in pack bridge | Tighten if exposed beyond loopback |

Closing REQ-AUTH-004 would mean optional **code** work (proxy model calls through an authenticated gateway). This document alone does not require that.

## B6. Requirement ID convention

| Attribute | Convention |
| --- | --- |
| ID | `REQ-<AREA>-<nnn>` |
| Priority | M / S / C |
| Verification | Harness id, gate check, UNTESTED, or FUTURE |
| Change control | Bump document version when acceptance text changes |

---

*End of combined PRD + formal requirements v1.1. Documentation only unless you choose to implement FUTURE items.*
