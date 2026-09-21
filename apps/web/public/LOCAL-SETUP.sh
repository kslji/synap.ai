#!/bin/bash
# local.ai — one-file local setup. Run from this folder:
#   bash LOCAL-SETUP.sh
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd)"
PORT=18766
STAMP="$(date +%s)"
URL="http://127.0.0.1:${PORT}/local-agent.html?v=${STAMP}"

echo "Surf AI — local Small Cloud on this computer"
echo "Folder: ${HERE}"
echo "Moss: add MOSS_PROJECT_ID / MOSS_PROJECT_KEY to the host .env when you run the full host;"
echo "      if credits fail, Surf falls back to on-device keyword search automatically."
echo

if [[ ! -f "${HERE}/local-agent.html" ]]; then
  echo "local-agent.html is not in this folder."
  echo "Unzip local-ai-on-this-device.zip, then run this script from the unzipped local-ai folder."
  exit 1
fi

if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo "Python 3 is not installed. The agent needs it only to serve files on ${URL}."
  echo "Install, then close Terminal and run this file again:"
  echo "  Mac:     https://www.python.org/downloads/macos/"
  echo "  Windows: https://www.python.org/downloads/windows/  (tick Add python.exe to PATH)"
  echo "  Other:   https://www.python.org/downloads/"
  if command -v brew >/dev/null 2>&1; then
    echo "  or: brew install python3"
  fi
  if command -v apt >/dev/null 2>&1; then
    echo "  or: sudo apt update && sudo apt install -y python3"
  fi
  exit 1
fi

echo "Python: $($PY --version 2>&1)"

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
    echo "Opening your usual browser instead."
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
import os, signal, subprocess, sys
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
  echo "Replacing the old page on port ${PORT} with files from this folder (so Chrome is not stuck on a previous zip)."
  stop_old_page
  sleep 0.35
fi

echo
echo "Starting Surf AI and opening Google Chrome…"
echo "Leave this window open while you chat. Close it when you are finished."
echo
serve_page
cleanup() { kill "${SERVER_PID}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if wait_ready; then
  open_chrome
else
  echo "Chrome is taking a moment. Opening it now."
  open_chrome
fi

wait "${SERVER_PID}" || true
