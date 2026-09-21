#!/bin/bash
# Surf AI — ONE command for every agent pack. Reads agent.json, then:
#   installs Ollama if needed → pulls the baked-in model → opens Chrome on localhost chat.
#   bash LOCAL-SETUP.sh
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
PORT=18766
STAMP="$(date +%s)"
URL="http://127.0.0.1:${PORT}/local-agent.html?v=${STAMP}"
CACHE="${HOME}/.surf-ai/cache"
mkdir -p "${CACHE}"

AGENT="ollama"
MODEL="llama3.2:3b"
TITLE="Ollama"
if [[ -f "${HERE}/agent.json" ]]; then
  if command -v python3 >/dev/null 2>&1; then PYJ=python3
  elif command -v python >/dev/null 2>&1; then PYJ=python
  else PYJ=""; fi
  if [[ -n "${PYJ}" ]]; then
    AGENT="$("${PYJ}" -c "import json;d=json.load(open('agent.json'));print(d.get('agent','ollama'))")"
    MODEL="$("${PYJ}" -c "import json;d=json.load(open('agent.json'));print(d.get('model') or 'llama3.2:3b')")"
    TITLE="$("${PYJ}" -c "import json;d=json.load(open('agent.json'));print(d.get('title') or 'Ollama')")"
  fi
fi

echo "Surf AI — one-command local chat"
echo "Pack: ${TITLE} (${AGENT})"
echo "Model: ${MODEL}"
echo "Folder: ${HERE}"
echo "After setup, Chrome opens http://127.0.0.1:${PORT}"
echo

download_to() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "${dest}" "${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "${dest}" "${url}"
  else
    echo "Need curl or wget once (while online) to finish setup."
    exit 1
  fi
}

if [[ ! -f "${HERE}/local-agent.html" ]]; then
  echo "local-agent.html missing. Unzip the pack again into a folder and re-run this command."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "Python 3 is required once to open chat in Chrome."
  echo "  Mac: https://www.python.org/downloads/macos/"
  echo "  Linux: sudo apt install python3"
  exit 1
fi

echo "Python: $($PY --version 2>&1)"

ensure_ollama() {
  if command -v ollama >/dev/null 2>&1; then return 0; fi
  echo "Installing Ollama (once, needs internet)…"
  if [[ "$(uname -s)" == Darwin ]]; then
    local dmg="${CACHE}/Ollama.dmg"
    if [[ ! -f "${dmg}" ]]; then
      download_to "https://ollama.com/download/Ollama.dmg" "${dmg}"
    fi
    open "${dmg}"
    echo "Finish installing Ollama (drag to Applications), open it once, then run again from any folder:"
    echo '  bash "$(ls "$HOME"/Downloads/local-ai/LOCAL-SETUP.sh "$HOME"/Downloads/*/LOCAL-SETUP.sh 2>/dev/null | head -n 1)"'
    exit 0
  fi
  if [[ "$(uname -s)" == Linux ]]; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  if ! command -v ollama >/dev/null 2>&1; then
    echo "Install Ollama from https://ollama.com , then re-run this script."
    exit 1
  fi
}

ensure_ollama

if ! curl -fsS --max-time 1 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Starting Ollama…"
  (ollama serve >/dev/null 2>&1 &) || true
  sleep 2
fi

echo "Ensuring model ${MODEL} is on this computer…"
if ! ollama list 2>/dev/null | grep -q "${MODEL}"; then
  echo "Downloading ${MODEL} (once). After this, chat works offline."
  ollama pull "${MODEL}"
else
  echo "Model already present — offline OK."
fi

# Soft notice for partner packs (licenses stay theirs; chat is our localhost UI).
case "${AGENT}" in
  gpt4all) echo "Engine pack: GPT4All (MIT). Chat opens in Chrome on this computer." ;;
  jan) echo "Engine pack: Jan (AGPL-3.0). Chat opens in Chrome on this computer." ;;
  anythingllm) echo "Engine pack: AnythingLLM (MIT). Chat opens in Chrome on this computer." ;;
esac

"$PY" - <<'PY'
import pathlib, urllib.request
here = pathlib.Path("local-agent.html")
for src in ("http://127.0.0.1:3000/local-agent.html", "http://localhost:3000/local-agent.html"):
    try:
        with urllib.request.urlopen(src, timeout=1.2) as r:
            body = r.read()
        if b"Surf AI" in body and b"Local setup command" not in body:
            here.write_bytes(body)
            print("Matched this folder to the hosted Surf AI UI.")
            break
    except Exception:
        pass
PY

"$PY" - <<'PY'
from pathlib import Path
import re
p = Path("local-agent.html")
t = p.read_text(encoding="utf-8", errors="replace")
t = re.sub(r"(?is)<button[^>]*>\s*Local setup command\s*</button>", "", t)
if "legacy-setup-killer" not in t:
    t = t.replace(
        "</head>",
        """<style id="legacy-setup-killer">
#setup-scrim, #setup-open, #setup-side, #setup-btn { display: none !important; }
.setup-scrim:not(#auth-scrim) { display: none !important; }
</style>
</head>""",
        1,
    )
p.write_text(t, encoding="utf-8")
PY

port_busy() {
  "$PY" - <<'PY'
import socket
s = socket.socket(); s.settimeout(0.4)
try: s.connect(("127.0.0.1", 18766))
except OSError: raise SystemExit(1)
finally: s.close()
raise SystemExit(0)
PY
}

wait_ready() {
  "$PY" - <<'PY'
import time, urllib.error, urllib.request
url = "http://127.0.0.1:18766/local-agent.html"
for _ in range(40):
    try:
        urllib.request.urlopen(url, timeout=0.5)
        raise SystemExit(0)
    except (urllib.error.URLError, TimeoutError, OSError):
        time.sleep(0.15)
raise SystemExit(1)
PY
}

open_chrome() {
  echo; echo "Opening Google Chrome → ${URL}"
  if [[ "$(uname -s)" == Darwin ]]; then
    open -na "Google Chrome" --args --new-window -- "${URL}" 2>/dev/null && return 0
    open -a "Google Chrome" "${URL}" 2>/dev/null && return 0
    echo "Install Chrome from https://www.google.com/chrome/ — opening default browser."
    open "${URL}" || true
    return 0
  fi
  if command -v google-chrome >/dev/null 2>&1; then
    google-chrome --new-window "${URL}" >/dev/null 2>&1 &
    return 0
  fi
  if command -v google-chrome-stable >/dev/null 2>&1; then
    google-chrome-stable --new-window "${URL}" >/dev/null 2>&1 &
    return 0
  fi
  if command -v chromium >/dev/null 2>&1; then
    chromium --new-window "${URL}" >/dev/null 2>&1 &
    return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" || true
  fi
}

stop_old_page() {
  "$PY" - <<'PY'
import os, signal, subprocess
try:
    out = subprocess.check_output(["lsof", "-tiTCP:18766", "-sTCP:LISTEN"], text=True)
except Exception:
    raise SystemExit(0)
for pid in {int(p) for p in out.split() if p.strip().isdigit()}:
    if pid == os.getpid(): continue
    try: os.kill(pid, signal.SIGTERM)
    except OSError: pass
PY
}

serve_page() {
  "$PY" - <<'PY' &
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()
ThreadingHTTPServer(("127.0.0.1", 18766), NoCache).serve_forever()
PY
  SERVER_PID=$!
}

if port_busy; then stop_old_page; sleep 0.35; fi

echo
echo "Starting local chat. Leave this window open while you use Surf."
echo
serve_page
cleanup() { kill "${SERVER_PID}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait_ready || true
open_chrome
wait "${SERVER_PID}" || true
