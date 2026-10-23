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

# The VS Code extension is its own npm package (not a root workspace), so it
# needs its own install before it can be compiled and tested.
EXT="$ROOT/surf-ide/code-oss/extensions/surf-ai"
echo "== surf-ai extension (compile + unit tests) =="
if [ ! -d "$EXT/node_modules" ]; then
  echo "-- installing $EXT dependencies --"
  ( cd "$EXT" && npm ci --no-audit --no-fund )
fi
( cd "$EXT" && npm run compile --silent )
( cd "$EXT" && npm test --silent )

# The benchmark's timing maths is pure, so it is testable without weights or a server.
echo "== offline bench harness (timing maths) =="
"$ROOT/node_modules/.bin/tsx" --test scripts/bench-offline/bench.test.ts

echo "OK scripts/check.sh"
