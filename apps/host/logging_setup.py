"""JSON logs on stderr. Gunicorn already captures stderr into apps/host/logs/error.log."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from config import settings

LOG = logging.getLogger("surf")


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("request_id", "method", "path", "status", "duration_ms", "client_ip"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


def configure() -> None:
    if LOG.handlers:
        return
    level_name = (settings.log_level or "info").upper()
    level = getattr(logging, level_name, logging.INFO)
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(_JsonFormatter())
    LOG.addHandler(handler)
    LOG.setLevel(level)
    LOG.propagate = False


def log_boot() -> None:
    configure()
    LOG.info("host boot", extra={"path": "lifespan", "status": 0})
    if not settings.is_production:
        return
    if not settings.smtp_host:
        LOG.warning("production boot without SMTP_HOST; OTP mail stays on this machine until SMTP is set")
    if not settings.admin_password:
        LOG.warning("production boot without ADMIN_PASSWORD; admin console login is disabled")
    if settings.livekit_api_key in {"", "devkey"} or settings.livekit_api_secret in {"", "secret"}:
        LOG.warning("LiveKit is still using local dev credentials; do not publish port 7880")
    origins = ",".join(settings.origins)
    LOG.info("production cors origins configured", extra={"path": origins[:180]})
