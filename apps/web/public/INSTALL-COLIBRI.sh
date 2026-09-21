#!/bin/bash
# One-command Colibri setup for Surf AI (optional engine).
# Online once to clone + build (+ download a model). Offline after that with COLI_MODEL set.
set -euo pipefail
DEST="${HOME}/colibri"
REPO="https://github.com/JustVugg/colibri.git"

echo "Surf AI — Colibri local agent"
echo "Repo: ${REPO}"
echo

if [[ ! -d "${DEST}/.git" ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "Git is required for the first install (while online)."
    exit 1
  fi
  echo "Cloning Colibri into ${DEST} …"
  git clone "${REPO}" "${DEST}"
else
  echo "Colibri already at ${DEST}"
  (cd "${DEST}" && git pull --ff-only) || echo "(Offline or no updates — using existing clone.)"
fi

cd "${DEST}/c"
if [[ -x ./setup.sh ]]; then
  echo "Building Colibri engine…"
  ./setup.sh
else
  echo "Build helper missing. See https://github.com/JustVugg/colibri"
  exit 1
fi

echo
echo "Engine ready."
echo "1) Download a Colibri model container onto a large disk (see Colibri README)."
echo "   Smallest family options start around ~7–20 GB; GLM-class containers are hundreds of GB."
echo "2) Serve OpenAI-compatible API (Surf / local host can use port 8000):"
echo "     COLI_MODEL=/path/to/model ./coli serve"
echo "3) Leave that running, start Surf LOCAL-SETUP, and chat."
echo
echo "With internet: clone/build/model download. Without internet: run coli serve if the model is already on disk."
