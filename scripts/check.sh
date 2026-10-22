#!/bin/sh
# CI and laptop checks that do not need a model or a running server.
# The auth host (apps/host) was removed with the legacy backend; the API's own
# suite runs via `python -m pytest` in services/api (see ci.yml).
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -x "$ROOT/services/api/.venv/bin/python3" ]; then
  PY="$ROOT/services/api/.venv/bin/python3"
else
  PY=python3
fi

echo "== harness unit evals =="
"$PY" harness/evals/test_reply_repair.py
"$PY" harness/evals/test_local_first.py
"$PY" harness/evals/test_eval_gate.py
"$PY" harness/evals/test_screenshot.py

echo "OK scripts/check.sh"
