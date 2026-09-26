"""Shared rate limits in the platform SQLite DB (one budget across gunicorn workers)."""

from __future__ import annotations

import sqlite3
import time

from fastapi import HTTPException, Request

from client_ip import client_ip
from config import settings
from errors import RATE_LIMIT_DETAIL
from logging_setup import LOG, configure
from platform_store import db_path

_ready = False
_checks = 0

_OTP_ISSUE = {"register", "forgot", "resend"}
_CREDENTIAL = {"login", "verify", "reset", "admin-login"}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=5)
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure() -> None:
    global _ready
    if _ready:
        return
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS rate_hits (
              bucket TEXT NOT NULL,
              ts REAL NOT NULL
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_rate_hits_bucket_ts ON rate_hits(bucket, ts)"
        )
    _ready = True


def _consume(bucket: str, limit: int, window_seconds: float) -> None:
    """Record one hit or raise 429. SQLite errors fail open so auth stays up."""
    global _checks
    if limit <= 0:
        return
    try:
        _ensure()
        now = time.time()
        cutoff = now - max(1.0, float(window_seconds))
        blocked = False
        with _connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            _checks += 1
            if _checks % 200 == 1:
                conn.execute("DELETE FROM rate_hits WHERE ts < ?", (now - 86400,))
            conn.execute("DELETE FROM rate_hits WHERE bucket = ? AND ts < ?", (bucket, cutoff))
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM rate_hits WHERE bucket = ? AND ts >= ?",
                (bucket, cutoff),
            ).fetchone()
            count = int(row[0] if row else 0)
            if count >= limit:
                blocked = True
            else:
                conn.execute("INSERT INTO rate_hits (bucket, ts) VALUES (?, ?)", (bucket, now))
        if blocked:
            raise HTTPException(status_code=429, detail=RATE_LIMIT_DETAIL)
    except HTTPException:
        raise
    except sqlite3.Error as exc:
        configure()
        LOG.warning("rate limit store unavailable; allowing request", extra={"path": str(exc)[:180]})


def rate_limit(
    request: Request,
    key: str,
    *,
    limit: int | None = None,
    window_seconds: float | None = None,
) -> None:
    cap = settings.chat_rate_per_minute if limit is None else limit
    window = 60.0 if window_seconds is None else window_seconds
    _consume(key, cap, window)
    # `request` is part of the call contract used by every route.
    del request


def limit_auth(request: Request, email: str, action: str) -> None:
    """Tighter budgets for OTP issue and password checks, plus a per-IP ceiling."""
    ip = client_ip(request)
    who = email.strip().lower()[:254] or "unknown"
    _consume(f"auth-email:{who}", settings.auth_rate_limit, settings.auth_rate_window_seconds)
    _consume(f"auth-ip:{ip}", settings.auth_ip_rate_limit, settings.auth_ip_rate_window_seconds)
    if action in _OTP_ISSUE:
        _consume(f"otp-email:{who}", settings.otp_rate_limit, settings.otp_rate_window_seconds)
        _consume(f"otp-ip:{ip}", settings.otp_ip_rate_limit, settings.otp_ip_rate_window_seconds)
    if action in _CREDENTIAL:
        _consume(
            f"cred-email:{who}",
            settings.login_rate_limit,
            settings.login_rate_window_seconds,
        )


def client_bucket(request: Request, name: str) -> str:
    return f"{name}:{client_ip(request)}"
