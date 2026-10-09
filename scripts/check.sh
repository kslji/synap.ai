#!/bin/sh
# CI and laptop checks that do not need Ollama or a running host.
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
"$PY" harness/evals/test_moss_pack.py
"$PY" harness/evals/test_pack_guardrails.py
"$PY" harness/evals/test_reply_repair.py
"$PY" harness/evals/test_resume_facts.py
"$PY" harness/evals/test_file_focus.py
"$PY" harness/evals/test_local_first.py
"$PY" harness/evals/test_zip_and_summary.py
"$PY" harness/evals/test_diagram_overview.py
"$PY" harness/evals/test_standalone.py
"$PY" harness/evals/test_pack_identity.py
"$PY" harness/evals/test_convert.py
"$PY" harness/evals/test_chat_markdown.py
"$PY" harness/evals/test_general_chat.py
"$PY" harness/evals/test_over_refusal.py
"$PY" harness/evals/test_fuzzy_intent.py

echo "OK scripts/check.sh"
echo "With the host on 127.0.0.1:18765, also run ./harness/run.sh"
