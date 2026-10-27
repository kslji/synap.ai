"""CORS built strictly from the ``CORS_ORIGINS`` allowlist.

Surf's real clients — the desktop app and the surf-ide extension — call the API
natively, not from a browser, so they need no CORS at all. CORS exists only for
specific web origins an operator names in ``CORS_ORIGINS`` (comma separated).

Rules that keep this safe:
  * No ``CORS_ORIGINS`` → no middleware is installed; the API answers same-origin
    and native clients only (the secure default).
  * A concrete origin list is served with credentials (cookies / Authorization).
  * A lone ``*`` is served WITHOUT credentials — browsers forbid ``*`` +
    credentials, and we never emit that combination.
"""
from __future__ import annotations

_METHODS = ["GET", "POST", "OPTIONS"]


def parse_origins(raw: str) -> list[str]:
    """Split a comma-separated origin list, dropping blanks."""
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def cors_kwargs(raw: str) -> dict | None:
    """CORSMiddleware kwargs for the given origin list, or None when empty."""
    origins = parse_origins(raw)
    if not origins:
        return None
    if "*" in origins:
        return {"allow_origins": ["*"], "allow_credentials": False, "allow_methods": ["*"], "allow_headers": ["*"]}
    return {"allow_origins": origins, "allow_credentials": True, "allow_methods": _METHODS, "allow_headers": ["*"]}
