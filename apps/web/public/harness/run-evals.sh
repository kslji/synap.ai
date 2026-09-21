#!/usr/bin/env bash
# Run pack-local evals (guardrails, Moss default, identity).
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "Python 3 required to run pack evals."
  exit 1
fi
exec "$PY" harness/run-evals.py
