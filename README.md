# Surf AI

Local-first file chat for the **YC × Moss Local-First / Small Cloud** track.

**License:** proprietary [Synap Developer License](LICENSE).

## How it works

`synap.surf` is a thin shell (landing, login, download). **AI never runs on the website.** Users download a zip, run one setup command on their laptop, and chat in Chrome on `127.0.0.1:18766` with **Ollama**.

```mermaid
flowchart LR
  Site["synap.surf<br/>download + auth"] -->|"zip"| Pack["Unzip + LOCAL-SETUP"]
  Pack --> Chat["Chrome :18766"]
  Chat --> Ollama["Ollama<br/>pack model tag"]
  Chat --> Moss["Moss retrieval<br/>online only"]
  Chat --> Disk["IndexedDB<br/>chats + files"]
```

### From ask to answer

```mermaid
flowchart TB
  Ask["User question + files"] --> Safe["Sanitize prompt"]
  Safe --> Ctx["Ground on named file / Moss"]
  Ctx --> Write{"Light overview ask?"}
  Write -->|yes| Extract["Extractive summary from file text"]
  Write -->|no| LLM["Ollama streams the answer"]
  Extract --> Out["Reply in Chrome"]
  LLM --> Out
```

| Layer | Role |
|---|---|
| **Download pack** | `local-agent.html`, `LOCAL-SETUP`, `agent.json` (model tag) |
| **Ollama** | Writes every answer (e.g. `llama3.2:1b`, `qwen2.5:1.5b`, `llama3.2:3b`) |
| **Moss** | Pulls text snippets into context when online; paused offline |
| **Named-file focus** | “harbour about” uses that zip only — not a sibling résumé |
| **Extractive path** | Tiny models + “what is this file” → teach from text, skip weak generation |

Prompts stay on the laptop. The VPS never sees chat bodies.

## Use it

1. Open `/download` → pick a model → download the zip  
2. Unzip → run `LOCAL-SETUP` (or `SURF-OPEN`)  
3. Chrome opens local chat — attach files and ask  

## Layout

```
apps/web     Site shell + pack assets
apps/host    Auth / OTP / feedback only
harness/     Evals (file-focus, zip, guardrails)
```
