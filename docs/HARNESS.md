# Evaluation harness

The harness scores the desktop app by calling the real orchestrator: the same retrieval, gate, prompt wrapping, calculator, and token budgeter a chat uses. It does not reimplement those steps in Python. Python loads cases, starts Electron, and scores the transcript.

Host checks (`./harness/run.sh` with no arguments) are unchanged. They still talk to the auth host on `127.0.0.1:18765` and do not need a model.

## Run it

From the repo root, with Node 22 and the llama-server sidecar installed:

```bash
python3 -m pip install -r harness/requirements.txt
cd apps/desktop && node scripts/fetch-sidecars.mjs && cd ../..
export SURF_MODELS_DIR="$HOME/surf-models"   # Qwen3.5-2B and EmbeddingGemma 2 GGUFs
npm run eval                                 # same as ./harness/run.sh quick
```

On a Mac the same command is the one to use. `quick` is the pull-request suite: the hand-written cases, one seeded row from each public dataset, and Qwen3.5-2B. `./harness/run.sh full` uses about 120 rows per dataset. If a 4B or 9B GGUF is in `SURF_MODELS_DIR`, full mode also records its latency and RSS. Quick mode records 2B and EmbeddingGemma, and notes when the larger files are absent.

The first good local run writes the baseline:

```bash
python3 harness/core/run_eval.py --mode quick --write-baseline
```

Commit `harness/baselines/quick.json`. Later runs fail when a suite drops by more than its tolerance. Reports land in `harness/reports/` as JSON, Markdown, and HTML. Dataset parquet stays in `harness/.cache/` and is not committed.

Eval mode asks the model at temperature 0 so a score change is a behavior change. The app's normal chat sampling is left as it is. The eval also opens its database with `SURF_EVAL_DB_KEY` so Linux without a keychain can still index documents. That key is random, per run, and is not a production unlock.

## What a case is

`harness/suites/shared/cases.jsonl` is one JSON object per line. A case has an id, a suite name, a weight, and one or more turns. A turn can attach fixture documents, turn Offline only on, or allow web search against the local fixture API. `expect` is the scorer: exact text, a substring, a number with a tolerance, a citation whose source contains the answer, the offline refusal, or an injection check (`PWNED` and `evil.example` must not appear).

Weights are the severity. The suite score is passed weight divided by total weight.

`harness/suites/shared/thresholds.yaml` sets `min_score` and `regression_tolerance` per suite, separately for `quick` and `full`. Quick public-dataset suites use a tolerance of 1 because a single row is either pass or fail. The weekly full run uses 0.05. The shared hand-written suite is gated on every pull request.

## Add a niche

Copy `harness/suites/niches/marine/`. Put cases in `cases.jsonl` with `"suite": "marine"`. Set `min_score` in that folder's `thresholds.yaml`. Load the file from `harness/core/run_eval.py` next to the shared JSONL. Until the niche has cases, pack signing uses the shared suite.

## Pack signing

`services/packs/build_pack.py` reads `SURF_EVAL_REPORT` (default `harness/reports/latest.json`) before it signs. If the niche has cases in that report, those cases must have passed. Otherwise the shared suite must have passed. A missing or failing report exits with `refusing to sign`. The desktop self-test points this variable at `harness/baselines/quick.json`, so a pack built there is still tied to a suite that passed.

## Update the baseline

Run the mode you want to lock, with `--write-baseline`, and commit the JSON under `harness/baselines/`. Do that when a prompt or scorer change moves the scores on purpose. A drop you did not intend should fail the run instead of being written over.

## Limits

The public-dataset samples are small on purpose in quick mode. A pass there is not a leaderboard score. The injection checks are the same heuristics the app already uses, plus the requirement that the model not emit the canary. They are not a proof that every future phrasing will be ignored. The optional judge (`local_judge` in `harness/core/scorers.py`) is off unless you call it, and it refuses any URL that is not loopback.
