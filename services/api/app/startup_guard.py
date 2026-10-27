"""Refuse to boot a production server on missing or placeholder secrets.

Development (the default, and every LITE-mode test) is untouched. Only an
explicit ``SURF_ENV=production`` makes configuration fatal at startup, so a
production instance can never come up signing tokens with a default key or
handing out OTP codes and licence keys in the response body.
"""
from __future__ import annotations

import os

ENV = os.environ

# Substrings that mark a secret as an example/placeholder rather than a real one.
_PLACEHOLDER_HINTS = ("change-me", "change_me", "changeme", "dev-only-secret", "placeholder", "xxx", "secret-test")


def is_production() -> bool:
    return ENV.get("SURF_ENV", "development").strip().lower() in {"production", "prod"}


def _weak(secret: str, minimum: int = 32) -> bool:
    """True when a secret is missing, too short, or still an .env.example placeholder.

    Length alone is not enough: the shipped placeholder is long, so we also scan
    for the obvious example markers.
    """
    if len(secret) < minimum:
        return True
    lowered = secret.lower()
    return any(hint in lowered for hint in _PLACEHOLDER_HINTS)


def validate_production_config() -> None:
    """Raise RuntimeError listing every production configuration error."""
    if not is_production():
        return
    problems: list[str] = []

    secret = ENV.get("JWT_SECRET", "").strip()
    if not secret:
        problems.append("JWT_SECRET is required (access tokens and pack download links are signed with it).")
    elif _weak(secret):
        problems.append("JWT_SECRET is a placeholder or too short; use a unique random secret of at least 32 bytes.")

    if ENV.get("MAIL_MODE", "console").strip().lower() != "smtp":
        problems.append("MAIL_MODE must be 'smtp' in production; console mail leaks OTP codes and licence keys.")

    key = ENV.get("OPENROUTER_API_KEY", "").strip()
    if not key and ENV.get("SURF_GATEWAY_OPTIONAL", "") != "1":
        problems.append("OPENROUTER_API_KEY is required for the Online gateway (set SURF_GATEWAY_OPTIONAL=1 to allow a gateway-less deployment).")

    # Without DATABASE_URL, main.py silently falls back to the in-memory LITE
    # stores (MemoryAuth/MemoryLicences), which lose all accounts on restart.
    database_url = ENV.get("DATABASE_URL", "").strip()
    if not database_url:
        problems.append("DATABASE_URL is required in production; the in-memory LITE store must never serve production traffic.")
    elif not ENV.get("VALKEY_URL", "").strip():
        problems.append("VALKEY_URL is required when DATABASE_URL is set (the non-LITE runtime needs Valkey for rate limiting).")

    if problems:
        raise RuntimeError("Refusing to start in production: " + " ".join(problems))
