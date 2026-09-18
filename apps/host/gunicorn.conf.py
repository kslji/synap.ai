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

bind = os.getenv("HOST_BIND", "127.0.0.1:18765")
worker_class = "uvicorn.workers.UvicornWorker"

_cpu = multiprocessing.cpu_count()
# Auth is CPU + SQLite. Each async worker already multiplexes I/O, so cap workers.
workers = int(os.getenv("WEB_CONCURRENCY", str(max(2, min(8, _cpu * 2 + 1)))))

# Chat streams can outlive the default 30s Gunicorn timeout.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "180"))
graceful_timeout = 30
keepalive = 5

max_requests = int(os.getenv("GUNICORN_MAX_REQUESTS", "1000"))
max_requests_jitter = 50

# Each worker must boot FastAPI itself (SQLite + lifespan). Do not preload.
preload_app = False
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL", "info")
