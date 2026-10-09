# Harness (auth host)

Run against a host on `127.0.0.1:18765`. This does not call OpenAI or Anthropic. Use the host venv:

```bash
chmod +x harness/run.sh
./harness/run.sh
```

The portable zip pack, `LOCAL-SETUP` / `SURF-OPEN`, and the in-zip `check-pack` scripts are removed. These checks cover the auth host that is still in the repo.

Unit evals (`test_guardrails.py`, `test_moss.py`, `test_convert.py`, `test_reply_repair.py`) do not need a model.

| File | What it proves |
|---|---|
| `evals/test_guardrails.py` | Injection, SSN, API keys, AWS, GitHub tokens, PEM |
| `evals/test_moss.py` | User-file retrieval; empty hits on unrelated queries; seed README never indexed |
| `evals/test_convert.py` | txt/csv/docx/xlsx → on-device PDF |
| `evals/test_reply_repair.py` | Looped light-model replies get deduped before they ship |
| `evals/fixtures/` | Invoice, bakery README, payroll handbook (user corpus, not product docs) |
| `evals/retrieval_cases.json` | Grounded queries + forbidden product strings |
| `evals/gate.py` | Host up, `platform_bytes=0`, Moss on-device, local LLM URL is loopback, plus unit checks |
| `evals/last-report.json` | Written by the gate (CI artifact) |
| `evals/smoke.py` | Register/verify JWT, feedback SQLite, Moss search of a unique user doc, chat cases if a local server is up |
| `evals/cases.json` | Live model cases (privacy, no cloud LLM, no invented Whisper/SDXL, no product README quote) |
| `evals/guardrail_cases.json` | Deterministic sanitizer cases |
| `prompts/system.md` | CRISPE system prompt loaded by the host |
| `schemas/trace.schema.json` | Shape of instance `traces/*.json` |

Chat smoke needs the host process. The new Surf AI desktop app does not use this host.
