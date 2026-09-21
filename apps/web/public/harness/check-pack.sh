#!/usr/bin/env bash
# Self-check for one Surf AI pack folder. Run from pack root or any cwd.
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass=0
fail=0
ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s — %s\n' "$1" "$2"; }

need() {
  local name="$1" path="$2"
  if [ -f "$path" ]; then ok "$name"
  else bad "$name" "missing $path"
  fi
}

need "agent.json" "agent.json"
need "MODEL.txt" "MODEL.txt"
need "local-agent.html" "local-agent.html"
need "LOCAL-SETUP.sh" "LOCAL-SETUP.sh"
need "SURF-OPEN.sh" "SURF-OPEN.sh"
need "system.md" "system.md"
need "harness/TESTS.md" "harness/TESTS.md"

if [ ! -f agent.json ]; then
  echo
  echo "Pack check aborted ($fail failed)."
  exit 1
fi

TITLE=""
TAG=""
ID=""
if command -v python3 >/dev/null 2>&1; then
  TITLE="$(python3 -c "import json;d=json.load(open('agent.json'));print(d.get('modelTitle') or '')" 2>/dev/null || true)"
  TAG="$(python3 -c "import json;d=json.load(open('agent.json'));print(d.get('model') or '')" 2>/dev/null || true)"
  ID="$(python3 -c "import json;d=json.load(open('agent.json'));print(d.get('modelId') or '')" 2>/dev/null || true)"
elif command -v python >/dev/null 2>&1; then
  TITLE="$(python -c "import json;d=json.load(open('agent.json'));print(d.get('modelTitle') or '')" 2>/dev/null || true)"
  TAG="$(python -c "import json;d=json.load(open('agent.json'));print(d.get('model') or '')" 2>/dev/null || true)"
  ID="$(python -c "import json;d=json.load(open('agent.json'));print(d.get('modelId') or '')" 2>/dev/null || true)"
fi

if [ -n "$TITLE" ] && [ -n "$TAG" ]; then
  ok "identity ${TITLE} (${TAG})"
else
  bad "identity" "agent.json missing modelTitle/model"
fi

if [ -f MODEL.txt ]; then
  if grep -q "title=${TITLE}" MODEL.txt 2>/dev/null && grep -q "tag=${TAG}" MODEL.txt 2>/dev/null; then
    ok "MODEL.txt matches agent.json"
  else
    bad "MODEL.txt" "does not match agent.json title/tag"
  fi
fi

HTML="$(cat local-agent.html)"
if printf '%s' "$HTML" | grep -q "$TAG"; then
  ok "html embeds model tag"
else
  bad "html embeds model tag" "tag $TAG not found in local-agent.html"
fi
if printf '%s' "$HTML" | grep -q "$TITLE"; then
  ok "html embeds model title"
else
  bad "html embeds model title" "title $TITLE not found"
fi

# Must not advertise a different catalog model as primary.
for other in "llama3.2:1b" "qwen2.5:1.5b" "llama3.2:3b" "phi3:mini"; do
  [ "$other" = "$TAG" ] && continue
  if printf '%s' "$HTML" | grep -q "\"model\":\"${other}\"" || printf '%s' "$HTML" | grep -q "\"model\": \"${other}\""; then
    bad "no-other-model" "pack embeds foreign model $other"
  fi
done
ok "no foreign catalog model as primary"

if printf '%s' "$HTML" | grep -q 'html.standalone #light-note'; then
  ok "hides light-note in standalone"
else
  bad "hides light-note" "missing standalone CSS hide for #light-note"
fi

if printf '%s' "$HTML" | grep -q 'Answers stay short on light models'; then
  bad "no-upsell" "standalone upsell copy still present"
else
  ok "no re-download upsell copy"
fi

if printf '%s' "$HTML" | grep -q 'summarize-side' && printf '%s' "$HTML" | grep -q 'compact()'; then
  ok "summarize wired"
else
  bad "summarize wired" "summarize-side / compact missing"
fi

if printf '%s' "$HTML" | grep -q 'erase-side' && printf '%s' "$HTML" | grep -q 'wipe()'; then
  ok "delete wired"
else
  bad "delete wired" "erase-side / wipe missing"
fi

if printf '%s' "$HTML" | grep -q 'mic-on' && printf '%s' "$HTML" | grep -q 'mic-live'; then
  ok "mic recording UI"
else
  bad "mic recording UI" "mic-on / mic-live missing"
fi

if grep -q 'modelTitle' SURF-OPEN.sh && ! grep -q 'agent:-Surf' SURF-OPEN.sh; then
  ok "SURF-OPEN labels use model name"
else
  bad "SURF-OPEN labels" "still may prefer agent/Ollama title"
fi

# Optional: Ollama reachability for this pack's tag
if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 1 http://127.0.0.1:11434/api/tags >/tmp/surf-ollama-tags.json 2>/dev/null; then
    if [ -n "$TAG" ] && grep -q "$TAG" /tmp/surf-ollama-tags.json 2>/dev/null; then
      ok "ollama has ${TAG}"
    else
      ok "ollama up (tag ${TAG} not pulled yet — LOCAL-SETUP will pull)"
    fi
  else
    ok "ollama not running yet (optional — run LOCAL-SETUP)"
  fi
  rm -f /tmp/surf-ollama-tags.json
fi

echo
if [ "$fail" -gt 0 ]; then
  echo "Pack check: ${pass} passed, ${fail} failed."
  echo "Re-download from synap.surf/download if identity or chat files look wrong."
  exit 1
fi
echo "Pack check: ${pass} passed. Ready for LOCAL-SETUP / SURF-OPEN."
if [ -n "$ID" ]; then
  echo "This pack: ${TITLE} · ${TAG} · ${ID}"
fi
