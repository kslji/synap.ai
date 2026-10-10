#!/bin/sh
# host: the existing auth-host checks (no desktop model).
# quick: PR eval, Qwen3.5-2B, small samples.
# full: weekly / laptop eval, about 120 rows per dataset.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -x "$ROOT/apps/host/.venv/bin/python3" ]; then
  PY="$ROOT/apps/host/.venv/bin/python3"
else
  PY=python3
fi
MODE="${1:-host}"
if [ "$MODE" = "host" ]; then
  "$PY" harness/evals/test_guardrails.py
  "$PY" harness/evals/test_moss.py
  "$PY" harness/evals/test_reply_repair.py
  "$PY" harness/evals/test_local_first.py
  "$PY" harness/evals/test_convert.py
  "$PY" harness/evals/test_eval_gate.py
  "$PY" harness/evals/gate.py
  "$PY" harness/evals/smoke.py
  exit 0
fi
if [ "$MODE" != "quick" ] && [ "$MODE" != "full" ]; then
  echo "usage: harness/run.sh [host|quick|full]" >&2
  exit 2
fi
shift
"$PY" -c 'import yaml, pyarrow' 2>/dev/null || {
  echo "Install harness dependencies: python3 -m pip install -r harness/requirements.txt" >&2
  exit 1
}
"$PY" harness/evals/test_eval_gate.py
export SURF_MODELS_DIR="${SURF_MODELS_DIR:-$HOME/surf-models}"
"$PY" harness/fetch_models.py
"$PY" harness/core/run_eval.py --mode "$MODE" "$@"
