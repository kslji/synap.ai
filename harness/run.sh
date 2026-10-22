#!/bin/sh
# unit: pure eval checks, no model, no server.
# quick: PR eval, Qwen3.5-2B, small samples.
# full: weekly / laptop eval, about 120 rows per dataset.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -x "$ROOT/services/api/.venv/bin/python3" ]; then
  PY="$ROOT/services/api/.venv/bin/python3"
else
  PY=python3
fi
MODE="${1:-unit}"
if [ "$MODE" = "unit" ]; then
  "$PY" harness/evals/test_reply_repair.py
  "$PY" harness/evals/test_local_first.py
  "$PY" harness/evals/test_eval_gate.py
  "$PY" harness/evals/test_screenshot.py
  exit 0
fi
if [ "$MODE" != "quick" ] && [ "$MODE" != "full" ]; then
  echo "usage: harness/run.sh [unit|quick|full]" >&2
  exit 2
fi
shift
"$PY" -c 'import yaml, pyarrow, sqlite_vec, uvicorn' 2>/dev/null || {
  echo "Install harness dependencies: python3 -m pip install -r harness/requirements.txt" >&2
  exit 1
}
"$PY" harness/evals/test_eval_gate.py
"$PY" harness/evals/test_screenshot.py
export SURF_MODELS_DIR="${SURF_MODELS_DIR:-$HOME/surf-models}"
"$PY" harness/fetch_models.py
"$PY" harness/core/run_eval.py --mode "$MODE" "$@"
