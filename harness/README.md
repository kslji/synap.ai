# Harness (production)

Run against a host on `127.0.0.1:18765`. This does not call OpenAI or Anthropic. Use the host venv:

```bash
chmod +x harness/run.sh
./harness/run.sh
```

Unit evals (`test_guardrails.py`, `test_moss.py`, `test_pack_identity.py`) do **not** need a model. They fail the pipeline if Moss would return product README/seed copy, sanitizers miss injection/secrets, or downloaded packs would ship the wrong model / Ollama label / upsell banner.

| File | What it proves |
|---|---|
| `evals/test_guardrails.py` | Injection, SSN, API keys, AWS, GitHub tokens, PEM |
| `evals/test_moss.py` | User-file retrieval; empty hits on unrelated queries; seed README never indexed |
| `evals/test_standalone.py` | Zip chat: no host auth leak, summarize/wipe/mic, light-note hidden |
| `evals/test_pack_identity.py` | SURF-OPEN model labels, verify-packs + verify-local-agent, pack harness present |
| `evals/test_convert.py` | txt/csv/docx/xlsx → on-device PDF |
| `evals/fixtures/` | Invoice, bakery README, payroll handbook (user corpus, not product docs) |
| `evals/retrieval_cases.json` | Grounded queries + forbidden product strings |
| `evals/gate.py` | Host up, `platform_bytes=0`, Moss on-device, local LLM URL is loopback, plus unit checks |
| `evals/last-report.json` | Written by the gate (CI artifact) |
| `evals/smoke.py` | Register/verify JWT, feedback SQLite, Moss search of a **unique** user doc, chat cases if a local server is up |
| `evals/cases.json` | Live model cases (privacy, no cloud LLM, no invented Whisper/SDXL, no product README quote) |
| `evals/guardrail_cases.json` | Deterministic sanitizer cases |
| `prompts/system.md` | CRISPE system prompt loaded by the host |
| `schemas/trace.schema.json` | Shape of instance `traces/*.json` |

### Pack downloads also ship a mini harness

Each zip includes `harness/check-pack.sh` (Mac/Linux) and `harness/check-pack.bat` (Windows). Users run it inside the unzipped folder to verify model identity, chat wiring, and optional Ollama. See `apps/web/public/harness/TESTS.md`.

Web-side quick checks (from `apps/web`):

```bash
npm run verify
```

Chat smoke needs Ollama, LM Studio (`:1234`), or `llama-server` (`:8080`). The gate still runs host privacy checks when the API is up.
