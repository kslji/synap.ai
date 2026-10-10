#!/bin/sh
# CI and laptop checks that do not need Ollama or a running host.
# Zip-pack evals are gone with the portable download.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -x "$ROOT/apps/host/.venv/bin/python3" ]; then
  PY="$ROOT/apps/host/.venv/bin/python3"
else
  PY=python3
fi

echo "== host production tests =="
(cd "$ROOT/apps/host" && "$PY" -m unittest discover -s tests -v)

echo "== harness unit evals =="
"$PY" harness/evals/test_guardrails.py
"$PY" harness/evals/test_moss.py
"$PY" harness/evals/test_reply_repair.py
"$PY" harness/evals/test_local_first.py
"$PY" harness/evals/test_convert.py
"$PY" harness/evals/test_eval_gate.py

echo "OK scripts/check.sh"
echo "With the host on 127.0.0.1:18765, also run ./harness/run.sh"
