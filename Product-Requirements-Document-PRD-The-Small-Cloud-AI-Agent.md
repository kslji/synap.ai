# Product Requirements Document (PRD): The Small Cloud AI Agent

## 1. Executive Summary
The "Small Cloud" AI Agent is a privacy-first, local-only browser copilot and productivity suite. Unlike traditional AI assistants that rely on cloud-based LLMs, this system executes all reasoning, data retrieval, and storage on the user’s local hardware. By leveraging a "Zero-Knowledge" architecture, the platform ensures that sensitive user data never leaves the device, providing a high-performance, offline-resilient experience for both technical and non-technical users.

## 2. Problem Statement
Users currently face a trade-off between AI utility and data privacy. Cloud-based AI tools require uploading personal data, browser history, and sensitive documents to third-party servers, creating security risks and dependency on internet connectivity. Furthermore, non-technical users often find local AI setup (Ollama, vector databases) too complex to manage.

## 3. Goals & Objectives
*   **Privacy Sovereignty:** Ensure 100% of data processing happens locally.
*   **Offline Excellence:** Maintain high accuracy and functionality without an internet connection.
*   **Zero-Knowledge Delivery:** Provide a web-based interface that acts only as a code delivery mechanism, with no backend access to user data.
*   **User Accessibility:** Create a "go-with-the-flow" experience for non-technical users while providing deep observability for power users.
*   **Hardware Resilience:** Optimize for local resource constraints (battery, CPU, RAM).

## 4. Target Users / Stakeholders
*   **Privacy-Conscious Individuals:** Users who refuse to use cloud AI due to data harvesting concerns.
*   **Non-Technical Users:** People who want a simple "install and use" AI experience.
*   **Developers/Power Users:** Users who require transparency, audit logs, and custom local configurations.
*   **Remote/Mobile Workers:** Users operating in low-bandwidth or offline environments.

## 5. Functional Requirements

### 5.1 Core AI & Reasoning
*   **Local LLM Integration:** Support for Llama 3.1 and Mistral via Ollama.
*   **Semantic Search (RAG):** On-device retrieval using Moss for personal files and browser history.
*   **Agentic Orchestration:** Multi-step reasoning and tool-calling using LangGraph and PydanticAI.
*   **Multimodal Capabilities:** Local Speech-to-Text (Whisper) and Local Image Generation (Stable Diffusion XL).

### 5.2 Browser Copilot Features
*   **Snapshot & Summarizer:** Automatically capture DOM snapshots of active tabs and generate 2-3 sentence summaries for local indexing.
*   **Automated Browser Sandbox:** Spin up headless Playwright/Puppeteer instances for web tasks without interfering with the user's main browser.
*   **Connectivity Management:** Manual/Auto toggle for Online/Offline modes with instant fallback to local models.

### 5.3 User Experience (UX)
*   **Onboarding Wizard:** A guided, non-technical setup to install local dependencies (Ollama, Moss).
*   **Adaptive UI:** 
    *   *Simple Mode:* Clean chat interface for general tasks.
    *   *Pro Mode:* Real-time traces, JSON outputs, and system logs.
*   **Transparency Dashboard:** Real-time visualization of data isolation (e.g., "0 KB sent to internet").

### 5.4 Security & Privacy
*   **Privacy Firewall:** Strict network isolation using CSP and local filtering (eBPF/WFP).
*   **Privacy Audit Log:** An immutable, local SQLite log of all internal data movements.
*   **Local Vault:** AES-256 encryption for all local data (Moss indexes, SQLite) secured by a user-defined Master Password.

## 6. Non-Functional Requirements
*   **Performance:** Local inference latency should be optimized via quantization (GGUF/GGML).
*   **Reliability:** Offline Accuracy Booster must use few-shot prompting and DSPy to maintain cloud-level precision.
*   **Sustainability:** Resource & Battery Monitor must throttle background tasks (like snapshotting) when system resources are low.
*   **Portability:** P2P Sync (Syncthing/Libp2p) for context sharing between user devices (Mobile/Desktop).

## 7. System Architecture Overview
The system follows a **Local-First Hybrid Architecture**:
1.  **Platform Delivery Layer:** A static host (Vercel/GitHub Pages) delivers the frontend code.
2.  **User Interface Layer:** React-based UI running WASM for client-side logic.
3.  **Local Runtime Layer:** A Local Execution Host (Pyodide or Local Python Runtime) that manages the Agent Orchestrator.
4.  **AI Engine Group:** Local servers for LLM (Ollama), Search (Moss), and Media (Whisper/SDXL).
5.  **Storage Layer:** Encrypted local databases (SQLite, IndexedDB, ChromaDB).

## 8. Tech Stack
*   **Frontend:** React, WASM Core, Framer Motion, Lucide Icons, Dexie.js (IndexedDB).
*   **Agent Framework:** Python, LangGraph, PydanticAI, FastAPI.
*   **AI Engines:** Ollama (Llama 3.1/Mistral), Moss (Rust-based search), Whisper, Stable Diffusion XL.
*   **Optimization:** DSPy, AutoGPTQ, GGML/GGUF, Zstandard compression.
*   **Security:** Argon2id (Key Derivation), AES-256-GCM, SQLCipher, eBPF/WFP.
*   **Automation:** Playwright, Puppeteer-Core.
*   **Infrastructure:** Vercel (Static), Syncthing SDK (P2P).

## 9. Data Requirements
*   **Data Sovereignty:** No user data is stored on the Platform Static Host.
*   **Local Storage:**
    *   **IndexedDB:** Browser-side cache for snapshots and session state.
    *   **SQLite:** Persistent chat history and Privacy Audit Logs.
    *   **ChromaDB/Moss:** Vector embeddings for semantic retrieval.
*   **Encryption:** All data at rest must be encrypted using keys derived from the Master Password via Argon2id.

## 10. API Specifications
*   **Localhost Handshake:** The UI communicates with local services via `localhost` ports (e.g., Ollama on 11434).
*   **WebSocket Tunnel:** Real-time, low-latency communication between the Zero-Knowledge UI and the Local Execution Host.
*   **Tool APIs:** PydanticAI-defined schemas for File System and Browser Automation tools.

## 11. Security Requirements
*   **Master Password:** Required to unlock the local encryption key; never stored or transmitted.
*   **Network Air-Gap:** The Privacy Firewall must block all outbound requests from the Agent Orchestrator unless explicitly whitelisted.
*   **Integrity Checks:** SHA-256 verification for all local model weights in the Model Registry.
*   **Prompt Injection Defense:** LLM-Guard and Regex-based PII filters to sanitize inputs and outputs.

## 12. Deployment & Infrastructure
*   **Client-Side Deployment:** Static assets served via CDN.
*   **Local Installation:** The Dependency Manager handles the "Small Cloud" environment setup on Windows/macOS/Linux.
*   **Containerization:** Optional Docker-Slim support for isolated browser sandboxing.

## 13. Success Metrics
*   **Privacy:** 0 bytes of user-generated content transmitted to the platform host.
*   **Accuracy:** Offline RAG performance within 90% of online benchmarks (measured via RAGAS).
*   **UX:** Successful onboarding completion rate > 80% for non-technical users.
*   **Performance:** UI responsiveness < 100ms for local interactions.

## 14. Timeline & Milestones
*   **Phase 1: Core Runtime:** Establish Local Execution Host, Ollama integration, and basic React UI.
*   **Phase 2: The Small Cloud:** Integrate Moss Retriever, Snapshot & Summarizer, and IndexedDB caching.
*   **Phase 3: Privacy & Security:** Implement Master Password vault, Privacy Firewall, and Audit Logs.
*   **Phase 4: Optimization:** Offline Accuracy Booster (DSPy), Quantization Engine, and Resource Monitor.

## 15. Open Questions & Risks
*   **Hardware Variability:** Performance on older machines without dedicated GPUs (MPS/CUDA).
*   **Browser Restrictions:** Potential limitations of WASM/Pyodide for high-memory Python libraries.
*   **Sync Complexity:** Managing P2P conflict resolution for the "Small Cloud" across multiple devices.

## 16. Hackathon stack lock (mandatory)
*   **FR-H1 Next.js:** UI is Next.js with `output: 'export'` (zero-knowledge static hosting). Vite is not used.
*   **FR-H2 LiveKit:** Local voice path uses LiveKit loopback (`livekit-server --dev` on ws://127.0.0.1:7880). Transcripts use browser dictation; Whisper is not loaded in the UI.
*   **FR-H3 Moss:** Every chat turn queries an on-device Moss session (or local fallback if SDK keys are unset). `push_index` is forbidden.

## 17. Numbered requirements & acceptance
| ID | Requirement | Acceptance | Component |
|---|---|---|---|
| FR-1.1 | Local LLM via Ollama | `/health` reports ollama; chat streams tokens | host + Ollama |
| FR-1.2 | Default small model | Default `llama3.2:3b`; RAM hint ≤ 3 GB; `keep_alive=30s` | ollama_client |
| FR-2.1 | Moss retrieval | Chat meta includes `moss.time_taken_ms` and hits | moss_runtime |
| FR-3.1 | Next.js static UI | `next build` emits `apps/web/out` | apps/web |
| FR-3.2 | LiveKit loopback | `/v1/livekit/token` returns JWT; client publishes mic | livekit_tokens + VoiceRoom |
| FR-3.3 | Browser dictation | Mic fills composer via SpeechRecognition | dictation.ts |
| FR-4.1 | Loopback JWT | `/v1/*` requires bearer except `/health` and `/v1/auth/*` signup routes | auth.py |
| FR-10.1 | Email profile + queued OTP | Register/login JWT in SQLite; email OTP via mail_jobs queue; reset via email OTP | accounts.py + mail_queue.py |
| FR-4.2 | Rate limit | Chat 429 after `chat_rate_per_minute` | rate_limit.py |
| FR-4.3 | Guardrails | Injection/PII patterns flagged in trace | guardrails.py |
| FR-4.4 | AES-256-GCM + Argon2id vault | Optional master password wraps data key; messages sealed `enc1:` | vault.py + store.py |
| FR-4.5 | Privacy audit log | Local JSONL of vault/chat/moss/prune events | audit.py |
| FR-5.2 | Onboarding wizard | UI checklist: host, Ollama, model pull, LiveKit, Moss keys, vault | Onboarding.tsx |
| FR-8.1 | IndexedDB session cache | Last thread restored in the tab | sessionCache.ts |
| FR-5.1 | Disk prune | Conversations/messages/traces capped | store.prune |
| FR-6.1 | CRISPE system prompt | `harness/prompts/system.md` | harness |
| FR-6.2 | Local traces | JSON traces with latency + moss ms (OTEL-shaped) | write_trace |
| FR-7.1 | Zero-knowledge host | UI never posts prompts to Vercel | Next static + localhost |
| NFR-1 | Chat UI local interaction | Composer send < 100ms to host accept (not model latency) | web |
| FR-9.1 | Human feedback | Authenticated `POST /v1/feedback` stores thumbs + title + message in instance SQLite; `GET` lists it | host + LocalChat + local-agent.html |

## 18. Explicitly not in v1 (do not claim in demo)
eBPF/WFP kernel firewall, Pyodide as orchestrator, Whisper weights, SDXL, Playwright sandbox, Syncthing P2P, DSPy, IEEE full SRS tool, cloud OpenTelemetry collector, OAuth2 (loopback JWT is the gateway).