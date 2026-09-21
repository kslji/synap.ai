#!/bin/bash
# Surf AI — pick among multiple downloaded packs, then open chat.
# From any directory:
#   bash "$(ls -t "$HOME"/Downloads/surf-ai-*/SURF-OPEN.sh 2>/dev/null | head -n 1)"
# Choose by number / name / model:
#   bash …/SURF-OPEN.sh 2
#   bash …/SURF-OPEN.sh phi
#   SURF_MODEL=llama3.2:3b bash …/SURF-OPEN.sh
set -eu

USER_ARG="${1:-}"

SETUPS=""

abs_setup() {
  local f="$1"
  [ -f "$f" ] || return 1
  echo "$(cd "$(dirname "$f")" && pwd)/LOCAL-SETUP.sh"
}

already() {
  local needle="$1" item
  # shellcheck disable=SC2086
  for item in $SETUPS; do
    [ "$item" = "$needle" ] && return 0
  done
  return 1
}

add_setup() {
  local real
  real="$(abs_setup "$1")" || return 0
  [ -f "$real" ] || return 0
  already "$real" && return 0
  SETUPS="${SETUPS}${SETUPS:+ }$real"
}

for root in "${HOME}/Downloads" "${HOME}/Desktop" "${HOME}/Documents"; do
  [ -d "$root" ] || continue
  for f in "$root"/surf-ai-*/LOCAL-SETUP.sh \
           "$root"/local-ai/LOCAL-SETUP.sh \
           "$root"/*/LOCAL-SETUP.sh; do
    add_setup "$f"
  done
done

if command -v find >/dev/null 2>&1; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    add_setup "$f"
  done <<EOF
$(find "${HOME}/Downloads" "${HOME}/Desktop" "${HOME}/Documents" -maxdepth 4 -type f -name LOCAL-SETUP.sh 2>/dev/null)
EOF
fi

if [ -z "$SETUPS" ]; then
  echo "No Surf AI packs found under Downloads, Desktop, or Documents."
  echo "Download a zip from https://synap.surf/download , unzip it, then run this again."
  exit 1
fi

# shellcheck disable=SC2086
set -- $SETUPS
COUNT=$#

py_json() {
  local dir="$1" expr="$2"
  SURF_AGENT_JSON="${dir}/agent.json" python3 -c "import json,os;d=json.load(open(os.environ['SURF_AGENT_JSON']));print($expr)" 2>/dev/null \
    || SURF_AGENT_JSON="${dir}/agent.json" python -c "import json,os;d=json.load(open(os.environ['SURF_AGENT_JSON']));print($expr)" 2>/dev/null \
    || true
}

label_for() {
  local dir title model agent folder
  dir="$(dirname "$1")"
  folder="$(basename "$dir")"
  title=""
  model=""
  agent=""
  if [ -f "${dir}/agent.json" ]; then
    title="$(py_json "$dir" "d.get('modelTitle') or d.get('title') or ''")"
    model="$(py_json "$dir" "d.get('model') or ''")"
    agent="$(py_json "$dir" "d.get('title') or d.get('agent') or ''")"
  fi
  if [ -n "$title" ] || [ -n "$model" ]; then
    echo "${agent:-Surf} · ${title:-$model} (${model:-?}) — ${folder}"
  else
    echo "Surf pack — ${folder}"
  fi
}

model_for() {
  local dir="$1"
  [ -f "${dir}/agent.json" ] || { echo ""; return; }
  py_json "$dir" "d.get('model') or ''"
}

pick=""

if [ -n "${SURF_MODEL:-}" ]; then
  for s in "$@"; do
    m="$(model_for "$(dirname "$s")")"
    if [ "$m" = "$SURF_MODEL" ]; then
      pick="$s"
      break
    fi
  done
  if [ -z "$pick" ]; then
    echo "No pack matched SURF_MODEL=${SURF_MODEL}"
    echo "Available:"
    i=1
    for s in "$@"; do
      echo "  ${i}) $(label_for "$s")"
      i=$((i + 1))
    done
    exit 1
  fi
fi

if [ -z "$pick" ] && [ -n "$USER_ARG" ]; then
  case "$USER_ARG" in
    *[!0-9]*)
      needle="$(printf '%s' "$USER_ARG" | tr '[:upper:]' '[:lower:]')"
      for s in "$@"; do
        dir="$(basename "$(dirname "$s")" | tr '[:upper:]' '[:lower:]')"
        m="$(model_for "$(dirname "$s")" | tr '[:upper:]' '[:lower:]')"
        case "$dir$m" in
          *"$needle"*) pick="$s"; break ;;
        esac
      done
      ;;
    *)
      if [ "$USER_ARG" -ge 1 ] 2>/dev/null && [ "$USER_ARG" -le "$COUNT" ]; then
        i=1
        for s in "$@"; do
          if [ "$i" -eq "$USER_ARG" ]; then
            pick="$s"
            break
          fi
          i=$((i + 1))
        done
      else
        echo "Choice ${USER_ARG} is out of range (1–${COUNT})."
        exit 1
      fi
      ;;
  esac
fi

if [ -z "$pick" ] && [ "$COUNT" -eq 1 ]; then
  pick="$1"
fi

if [ -z "$pick" ]; then
  echo "Surf AI — multiple packs on this computer:"
  echo
  i=1
  for s in "$@"; do
    echo "  ${i}) $(label_for "$s")"
    i=$((i + 1))
  done
  echo
  printf "Open which pack? [1-%s]: " "$COUNT"
  read -r choice || true
  case "$choice" in
    ''|*[!0-9]*) echo "Cancelled."; exit 1 ;;
  esac
  if [ "$choice" -lt 1 ] || [ "$choice" -gt "$COUNT" ]; then
    echo "Cancelled."
    exit 1
  fi
  i=1
  for s in "$@"; do
    if [ "$i" -eq "$choice" ]; then
      pick="$s"
      break
    fi
    i=$((i + 1))
  done
fi

echo "Opening: $(label_for "$pick")"
echo
exec bash "$pick"
