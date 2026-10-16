#!/usr/bin/env bash
# One command for a full Qwen 2B, 4B, and 9B run, including the mmproj add-on.
# Weights download into SURF_MODELS_DIR (default ~/surf-models) and are not committed.
# The numbers land in harness/reports/model-eval-full.json and harness/reports/ram.json.
# Copy the report to harness/baselines/model-eval-full.json when a release should accept it.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export SURF_MODELS_DIR="${SURF_MODELS_DIR:-$HOME/surf-models}"
mkdir -p "$SURF_MODELS_DIR" harness/reports
(cd apps/desktop && node scripts/fetch-sidecars.mjs)
node apps/desktop/scripts/model-weights.mjs --ids qwen3.5-2b-q4_k_m,qwen3.5-4b-q4_k_m,qwen3.5-9b-q4_k_m --mmproj --dir "$SURF_MODELS_DIR"
npx tsx apps/desktop/scripts/model-eval.ts --mode full --models qwen3.5-2b-q4_k_m,qwen3.5-4b-q4_k_m,qwen3.5-9b-q4_k_m --mmproj --out harness/reports/model-eval-full.json
npx tsx apps/desktop/scripts/measure-ram.ts --out harness/reports/ram.json
echo "Full results: harness/reports/model-eval-full.json"
echo "RAM results: harness/reports/ram.json"
