# Harness

Two things live here: pure unit evals that need no model and no server, and the
desktop model eval (`quick`/`full`) that runs real local models. The auth-host
checks (`test_guardrails.py`, `test_moss.py`, `test_convert.py`, `smoke.py`) and
the host go/no-go `gate.py main()` left the repo with `apps/host`.

```bash
chmod +x harness/run.sh
./harness/run.sh unit    # pure checks, no model, no server
./harness/run.sh quick   # PR eval, Qwen3.5-2B, small samples
./harness/run.sh full    # weekly / laptop eval, ~120 rows per dataset
```

| File | What it proves |
|---|---|
| `evals/test_reply_repair.py` | Looped light-model replies get deduped before they ship |
| `evals/test_local_first.py` | `deploy/.env.example` has empty secrets and no legacy host config |
| `evals/test_eval_gate.py` | `gate.compare_eval` enforces suite floors and baseline regression |
| `evals/test_screenshot.py` | Screenshot OCR fixtures surface the right error lines |
| `evals/gate.py` | Eval score thresholds: min_score floors + baseline regression tolerance |
| `evals/fixtures/` | Invoice, bakery README, payroll handbook (user corpus, not product docs) |
| `evals/cases.json` | Live model cases (privacy, no cloud LLM, no invented Whisper/SDXL, no product README quote) |
| `evals/guardrail_cases.json` | Deterministic sanitizer cases |
| `prompts/system.md` | CRISPE system prompt for local runs |
| `schemas/trace.schema.json` | Shape of instance `traces/*.json` |

The desktop eval lives beside these checks. `./harness/run.sh quick` and `npm run eval` run the real orchestrator and write `harness/reports/`. See `docs/HARNESS.md`.
