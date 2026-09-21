#!/bin/bash
# Pull an Ollama model matched to this computer. Usage:
#   bash PULL-MODEL.sh              # default llama3.2:1b
#   bash PULL-MODEL.sh llama3.2:1b
set -euo pipefail
MODEL="${1:-llama3.2:1b}"

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is not installed yet."
  echo "Mac: https://ollama.com/download"
  echo "Linux: curl -fsSL https://ollama.com/install.sh | sh"
  echo "Windows: install Ollama, then open a new Command Prompt and run:"
  echo "  ollama pull ${MODEL}"
  exit 1
fi

echo "Downloading model: ${MODEL}"
echo "Needs internet once. After that, Surf can chat offline with this model."
ollama pull "${MODEL}"
echo
echo "Done. Leave Ollama running, then use Surf (LOCAL-SETUP) to chat."
