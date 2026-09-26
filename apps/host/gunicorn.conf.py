"""Process manager for the FastAPI host (auth, feedback, chat proxy).

  cd apps/host
  source .venv/bin/activate
  set -a && source ../../.env && set +a
  WEB_CONCURRENCY=2 gunicorn -c gunicorn.conf.py main:app
"""

from __future__ import annotations

import multiprocessing
import os

bind = os.getenv("HOST_BIND", "127.0.0.1:18765").strip()
# .env sometimes sets HOST_BIND=127.0.0.1 and HOST_PORT=18765 separately.
if ":" not in bind.rsplit("%", 1)[-1].split("]")[-1]:
    bind = f"{bind}:{os.getenv('HOST_PORT', '18765').strip() or '18765'}"
worker_class = "uvicorn.workers.UvicornWorker"

_cpu = multiprocessing.cpu_count()
# Marketing VPS is auth-only + SQLite. Keep workers low so boot stays stable.
workers = int(os.getenv("WEB_CONCURRENCY", "2"))

timeout = int(os.getenv("GUNICORN_TIMEOUT", "180"))
graceful_timeout = 30
keepalive = 5

max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = 50

preload_app = False

# File logs avoid Python 3.13 reentrant stderr crashes when workers die.
_log_dir = os.getenv(
    "GUNICORN_LOG_DIR",
    os.path.join(os.path.expanduser("~"), "surf.ai", "apps", "host", "logs"),
)
try:
    os.makedirs(_log_dir, exist_ok=True)
    accesslog = os.path.join(_log_dir, "access.log")
    errorlog = os.path.join(_log_dir, "error.log")
except OSError:
    accesslog = "-"
    errorlog = "-"

loglevel = os.getenv("LOG_LEVEL", "info")
capture_output = True
# Path only (%(U)s). The request line (%(r)s) would log search queries and emails.
access_log_format = "%(h)s %(m)s %(U)s %(s)s %(b)s %(M)sms"
