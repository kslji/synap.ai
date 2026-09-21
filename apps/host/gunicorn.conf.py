"""Process manager for the FastAPI host (auth, feedback, chat proxy).

Gunicorn forks several processes. Each process runs an ASGI Uvicorn worker, so
many logins can run at once instead of lining up on a single Python process.

  cd apps/host
  source .venv/bin/activate
  gunicorn -c gunicorn.conf.py main:app

Simpler (no Gunicorn): Uvicorn can fork workers itself:

  uvicorn main:app --host 127.0.0.1 --port 18765 --workers 4

Use Gunicorn when you want timeouts, recycle, and a production arbiter.
Use Uvicorn --workers for a shorter local command. Do not use both together.
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
# Auth is CPU + SQLite. Cap workers so boot migrations don't race hard on small VMs.
workers = int(os.getenv("WEB_CONCURRENCY", str(max(2, min(4, _cpu + 1)))))

# Chat streams can outlive the default 30s Gunicorn timeout.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "180"))
graceful_timeout = 30
keepalive = 5

max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = 50

# Each worker must boot FastAPI itself (SQLite + lifespan). Do not preload.
preload_app = False

# Prefer a file log so worker crashes don't recurse into stderr (Python 3.13).
_log_dir = os.getenv("GUNICORN_LOG_DIR", "").strip()
if _log_dir:
    os.makedirs(_log_dir, exist_ok=True)
    accesslog = os.path.join(_log_dir, "access.log")
    errorlog = os.path.join(_log_dir, "error.log")
else:
    accesslog = "-"
    errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
capture_output = True
