#!/bin/sh
# Host checks that do not need the retired zip pack. Chat smoke still needs the host on :18765.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -x "$ROOT/apps/host/.venv/bin/python3" ]; then
  PY="$ROOT/apps/host/.venv/bin/python3"
else
  PY=python3
fi
"$PY" harness/evals/test_guardrails.py
"$PY" harness/evals/test_moss.py
"$PY" harness/evals/test_reply_repair.py
"$PY" harness/evals/test_convert.py
"$PY" harness/evals/gate.py
"$PY" harness/evals/smoke.py
