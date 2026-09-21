#!/bin/sh
# Production harness: unit evals (no model), then loopback gate + optional live chat.
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
"$PY" harness/evals/test_moss_pack.py
"$PY" harness/evals/test_pack_guardrails.py
"$PY" harness/evals/test_reply_repair.py
"$PY" harness/evals/test_resume_facts.py
"$PY" harness/evals/test_file_focus.py
"$PY" harness/evals/test_standalone.py
"$PY" harness/evals/test_pack_identity.py
"$PY" harness/evals/test_convert.py
"$PY" harness/evals/gate.py
"$PY" harness/evals/smoke.py
