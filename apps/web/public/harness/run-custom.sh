#!/usr/bin/env bash
# Run user-customizable pack harness cases (edit harness/custom_cases.json first).
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "Python 3 required to run custom harness cases."
  exit 1
fi
exec "$PY" harness/run-custom.py
