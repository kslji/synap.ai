"""Map OpenRouter/provider failures to clean, user-facing gateway errors.

A Surf client authenticates with its own JWT and never sees a provider key. A
provider-side failure (bad/expired master key, upstream rate limit, outage) must
therefore reach the user as a short, actionable message — not a raw httpx error
or the provider's response body, and not an opaque HTTP 500. The full upstream
detail is logged server-side instead.

The ``code`` on each message matches the desktop gateway client's error parser
and the SSE ``{"error": {"code", "message"}}`` event shape.
"""
from __future__ import annotations

import logging
from typing import NoReturn

import httpx
from fastapi import HTTPException

log = logging.getLogger("surf.gateway.errors")

GATEWAY_UNAVAILABLE = "The cloud model is unavailable right now. Please try again in a moment."
RATE_LIMITED = "The cloud model is busy. Please try again in a moment."
INSUFFICIENT_CREDITS = "You're out of Surf credits. Top up to keep using cloud models."
PROBLEM_WITH_MODEL = "There was a problem with that model. Try again or pick another."
NOT_CONFIGURED = "Online chat isn't configured on this server."

# Provider status -> what the user should be told. Ambiguous 5xx map to the
# generic retry message; we never forward the provider's own text.
_STATUS_MAP: dict[int, tuple[int, str]] = {
    401: (503, GATEWAY_UNAVAILABLE),
    402: (402, INSUFFICIENT_CREDITS),
    403: (503, GATEWAY_UNAVAILABLE),
    408: (504, GATEWAY_UNAVAILABLE),
    429: (429, RATE_LIMITED),
}


def _retry_after(exc: httpx.HTTPStatusError) -> int | None:
    raw = exc.response.headers.get("retry-after") if exc.response is not None else None
    if raw and raw.isdigit():
        return int(raw)
    return None


def map_provider_error(exc: Exception) -> HTTPException:
    """Translate an httpx failure from the provider into a clean HTTPException."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code if exc.response is not None else 0
        code, message = _STATUS_MAP.get(status, (0, ""))
        if status >= 500:
            code, message = 502, GATEWAY_UNAVAILABLE
        if not code:
            code, message = 502, PROBLEM_WITH_MODEL
        log.error("provider returned %s: %s", status, exc)
        http = HTTPException(status_code=code, detail=message)
        retry = _retry_after(exc)
        if retry is not None:
            http.headers = {"Retry-After": str(retry)}
        return http
    if isinstance(exc, httpx.TimeoutException):
        log.error("provider timed out: %s", exc)
        return HTTPException(status_code=504, detail=GATEWAY_UNAVAILABLE)
    if isinstance(exc, httpx.HTTPError):
        log.error("provider transport error: %s", exc)
        return HTTPException(status_code=502, detail=GATEWAY_UNAVAILABLE)
    log.error("gateway failure: %s", exc)
    return HTTPException(status_code=502, detail=GATEWAY_UNAVAILABLE)


def user_facing_message(exc: Exception) -> str:
    """A short, safe message for a mid-stream error event; never the raw exception."""
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    if isinstance(exc, httpx.TimeoutException):
        return GATEWAY_UNAVAILABLE
    if isinstance(exc, httpx.HTTPError):
        return GATEWAY_UNAVAILABLE
    return GATEWAY_UNAVAILABLE


def raise_mapped(exc: Exception) -> NoReturn:
    """Raise a provider failure as a clean HTTPException, without chaining the raw
    exception (so tracebacks/handlers never surface the provider's response body)."""
    raise map_provider_error(exc) from None
