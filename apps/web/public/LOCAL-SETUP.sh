#!/bin/bash
# Surf AI — ONE command after unzip. Reads agent.json (baked into the zip you downloaded).
#   bash LOCAL-SETUP.sh
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
PORT=18766
STAMP="$(date +%s)"
URL="http://127.0.0.1:${PORT}/local-agent.html?v=${STAMP}"
CACHE="${HOME}/.surf-ai/cache"
mkdir -p "${CACHE}"

AGENT="surf"
MODEL="llama3.2:3b"
TITLE="Surf + Ollama"
if [[ -f "${HERE}/agent.json" ]]; then
  # Prefer python for JSON; fall back to grep.
  if command -v python3 >/dev/null 2>&1; then
    PYJ=python3
  elif command -v python >/dev/null 2>&1; then
    PYJ=python
  else
    PYJ=""
  fi
  if [[ -n "${PYJ}" ]]; then
    AGENT="$("${PYJ}" -c "import json;d=json.load(open('agent.json'));print(d.get('agent','surf'))")"
    MODEL="$("${PYJ}" -c "import json;d=json.load(open('agent.json'));print(d.get('model') or 'llama3.2:3b')")"
    TITLE="$("${PYJ}" -c "import json;d=json.load(open('agent.json'));print(d.get('title') or 'Surf')")"
  fi
fi

echo "Surf AI — one-command local setup"
echo "Pack: ${TITLE} (${AGENT})"
echo "Folder: ${HERE}"
echo

# ─── Desktop partners: download once, then open the app ─────────────────────
open_url() {
  local u="$1"
  if [[ "$(uname -s)" == Darwin ]]; then
    open "${u}" || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${u}" || true
  fi
}

download_to() {
  local url="$1" dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --progress-bar -o "${dest}" "${url}"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "${dest}" "${url}"
  else
    echo "Need curl or wget (once, while online) to fetch the installer."
    exit 1
  fi
}

run_gpt4all() {
  echo "GPT4All (MIT) — https://www.nomic.ai/gpt4all"
  local os; os="$(uname -s)"
  local dest app
  if [[ "${os}" == Darwin ]]; then
    dest="${CACHE}/gpt4all-installer.dmg"
    app="/Applications/gpt4all.app"
    if [[ -d "${app}" ]]; then
      echo "Opening installed GPT4All…"
      open -a gpt4all || open "${app}"
      return 0
    fi
    if [[ ! -f "${dest}" ]]; then
      echo "Downloading GPT4All installer (once)…"
      download_to "https://gpt4all.io/installers/gpt4all-installer-darwin.dmg" "${dest}"
    fi
    echo "Opening installer — drag GPT4All to Applications if asked, then re-run this command."
    open "${dest}"
  elif [[ "${os}" == Linux ]]; then
    dest="${CACHE}/gpt4all-installer-linux.run"
    if [[ ! -x "${dest}" ]]; then
      echo "Downloading GPT4All installer (once)…"
      download_to "https://gpt4all.io/installers/gpt4all-installer-linux.run" "${dest}"
      chmod +x "${dest}"
    fi
    echo "Starting GPT4All installer…"
    "${dest}" &
  else
    echo "On Windows use LOCAL-SETUP.bat from this folder."
    exit 1
  fi
}

run_jan() {
  echo "Jan AI (AGPL-3.0) — https://jan.ai"
  local os; os="$(uname -s)"
  local dest
  if [[ "${os}" == Darwin ]]; then
    if [[ -d "/Applications/Jan.app" ]]; then
      open -a Jan
      return 0
    fi
    dest="${CACHE}/jan.dmg"
    if [[ ! -f "${dest}" ]]; then
      echo "Downloading Jan (once)…"
      download_to "https://app.jan.ai/download/latest/mac-universal" "${dest}" || \
        download_to "https://github.com/janhq/jan/releases/latest/download/jan-mac-x64.dmg" "${dest}"
    fi
    open "${dest}"
    echo "Drag Jan to Applications, then re-run this command to open it."
  elif [[ "${os}" == Linux ]]; then
    dest="${CACHE}/jan.AppImage"
    if [[ ! -x "${dest}" ]]; then
      echo "Downloading Jan AppImage (once)…"
      download_to "https://app.jan.ai/download/latest/linux-amd64-appimage" "${dest}"
      chmod +x "${dest}"
    fi
    "${dest}" &
  else
    echo "On Windows use LOCAL-SETUP.bat from this folder."
    exit 1
  fi
}

run_anythingllm() {
  echo "AnythingLLM (MIT) — https://anythingllm.com"
  local os; os="$(uname -s)"
  local dest
  if [[ "${os}" == Darwin ]]; then
    if [[ -d "/Applications/AnythingLLM.app" ]]; then
      open -a AnythingLLM
      return 0
    fi
    dest="${CACHE}/AnythingLLMDesktop.dmg"
    local arch; arch="$(uname -m)"
    local url="https://cdn.anythingllm.com/latest/AnythingLLMDesktop.dmg"
    if [[ "${arch}" == arm64 ]]; then
      url="https://cdn.anythingllm.com/latest/AnythingLLMDesktop-Silicon.dmg"
    fi
    if [[ ! -f "${dest}" ]]; then
      echo "Downloading AnythingLLM Desktop (once)…"
      download_to "${url}" "${dest}"
    fi
    open "${dest}"
    echo "Drag AnythingLLM to Applications, then re-run this command to open it."
  elif [[ "${os}" == Linux ]]; then
    echo "Running official AnythingLLM Linux installer…"
    curl -fsSL https://cdn.anythingllm.com/latest/installer.sh -o "${CACHE}/anythingllm-installer.sh"
    chmod +x "${CACHE}/anythingllm-installer.sh"
    "${CACHE}/anythingllm-installer.sh"
  else
    echo "On Windows use LOCAL-SETUP.bat from this folder."
    exit 1
  fi
}

case "${AGENT}" in
  gpt4all) run_gpt4all; exit 0 ;;
  jan) run_jan; exit 0 ;;
  anythingllm) run_anythingllm; exit 0 ;;
  surf|ollama|"") ;;
  *)
    echo "Unknown agent '${AGENT}' in agent.json — defaulting to Surf + Ollama."
    ;;
esac

# ─── Surf + Ollama: install engine, pull model, open browser chat ───────────
if [[ ! -f "${HERE}/local-agent.html" ]]; then
  echo "local-agent.html missing. Unzip the Surf pack again."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Python 3 is required once to open Surf in Chrome."
  echo "  Mac: https://www.python.org/downloads/macos/"
  echo "  Windows: https://www.python.org/downloads/windows/"
  exit 1
fi

echo "Python: $($PY --version 2>&1)"
echo "Model (baked into this zip): ${MODEL}"

ensure_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    return 0
  fi
  echo "Installing Ollama (once, needs internet)…"
  if [[ "$(uname -s)" == Darwin ]]; then
    local dmg="${CACHE}/Ollama.dmg"
    if [[ ! -f "${dmg}" ]]; then
      download_to "https://ollama.com/download/Ollama.dmg" "${dmg}"
    fi
    open "${dmg}"
    echo "Finish installing Ollama (drag to Applications), open it once, then re-run:"
    echo "  bash LOCAL-SETUP.sh"
    exit 0
  fi
  if [[ "$(uname -s)" == Linux ]]; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  if ! command -v ollama >/dev/null 2>&1; then
    echo "Ollama not found after install. Open https://ollama.com , install, re-run this script."
    exit 1
  fi
}

ensure_ollama

# Start ollama serve in background if needed
if ! curl -fsS --max-time 1 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Starting Ollama…"
  (ollama serve >/dev/null 2>&1 &) || true
  sleep 2
fi

echo "Ensuring model ${MODEL} is on this computer…"
if ! ollama list 2>/dev/null | grep -q "${MODEL}"; then
  echo "Downloading ${MODEL} (once). After this, Surf works offline."
  ollama pull "${MODEL}"
else
  echo "Model already present — offline OK."
fi

"$PY" - <<'PY'
import pathlib, urllib.request
here = pathlib.Path("local-agent.html")
for src in ("http://127.0.0.1:3000/local-agent.html", "http://localhost:3000/local-agent.html"):
    try:
        with urllib.request.urlopen(src, timeout=1.2) as r:
            body = r.read()
        if b"Surf AI" in body and b"Local setup command" not in body and b"What's on your mind" not in body:
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
<script id="legacy-setup-killer-js">
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".setup-scrim, button").forEach(function (el) {
    var tx = el.textContent || "";
    if (!/Local setup command|You do not need to be a programmer/i.test(tx)) return;
    var root = el.closest(".setup-scrim") || el;
    if (root && root.id !== "auth-scrim") root.remove();
  });
});
</script>
</head>""",
        1,
    )
p.write_text(t, encoding="utf-8")
PY

port_busy() {
  "$PY" - <<'PY'
import socket
s = socket.socket()
s.settimeout(0.4)
try:
    s.connect(("127.0.0.1", 18766))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
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
  echo
  echo "Opening Google Chrome…"
  if [[ "$(uname -s)" == Darwin ]]; then
    if open -na "Google Chrome" --args --new-window -- "${URL}" 2>/dev/null; then
      return 0
    fi
    if open -a "Google Chrome" "${URL}" 2>/dev/null; then
      return 0
    fi
    echo "Google Chrome is not installed. Get it from https://www.google.com/chrome/"
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
    if pid == os.getpid():
        continue
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
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

if port_busy; then
  echo "Refreshing the local page…"
  stop_old_page
  sleep 0.35
fi

echo
echo "Starting Surf chat in Chrome. Leave this window open while you chat."
echo
serve_page
cleanup() { kill "${SERVER_PID}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if wait_ready; then
  open_chrome
else
  open_chrome
fi

wait "${SERVER_PID}" || true
