"""Client IP for rate limits.

Gunicorn on the marketing VPS binds to loopback and nginx is the only peer.
Trust X-Real-IP / X-Forwarded-For only in that case. A direct non-loopback
connection cannot spoof the header to dodge limits.
"""

from __future__ import annotations

import ipaddress

from fastapi import Request

from config import settings

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def _valid_ip(value: str) -> str | None:
    raw = (value or "").strip()
    if not raw or len(raw) > 64:
        return None
    if raw.startswith("[") and "]" in raw:
        raw = raw[1 : raw.index("]")]
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return None


def _peer(request: Request) -> str:
    client = request.client
    if client is None:
        return ""
    return _valid_ip(client.host) or ""


def is_loopback_peer(request: Request) -> bool:
    peer = request.client.host if request.client else ""
    return peer in _LOOPBACK or peer.startswith("127.")


def is_direct_loopback(request: Request) -> bool:
    """True for a laptop or a VPS curl to 127.0.0.1, false for nginx-forwarded browsers.

    Nginx's peer is always loopback, so the forwarded client IP decides.
    """
    if not is_loopback_peer(request):
        return False
    if not settings.trust_proxy_headers:
        return True
    seen = client_ip(request)
    if seen in _LOOPBACK:
        return True
    try:
        return ipaddress.ip_address(seen).is_loopback
    except ValueError:
        return False


def client_ip(request: Request) -> str:
    peer = _peer(request)
    if settings.trust_proxy_headers and is_loopback_peer(request):
        real = _valid_ip(request.headers.get("x-real-ip", ""))
        if real:
            return real
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            first = _valid_ip(forwarded.split(",", 1)[0])
            if first:
                return first
    return peer or "unknown"
