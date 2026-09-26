"""Request id, security headers, body cap, and a cheap per-IP ceiling on auth posts.

Pure ASGI so chat streams are not buffered. CORS middleware must wrap this one
so short-circuit responses still get Access-Control-Allow-Origin.
"""

from __future__ import annotations

import json
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from config import settings
from errors import RATE_LIMIT_DETAIL, error_payload
from logging_setup import LOG, configure
from rate_limit import client_bucket, rate_limit

_HEALTH = {"/health", "/healthz", "/ready", "/v1/health"}
_SECURITY = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"x-permitted-cross-domain-policies", b"none"),
)


def _header(scope: Scope, name: str) -> str:
    target = name.lower().encode()
    for key, value in scope.get("headers") or []:
        if key.lower() == target:
            return value.decode("latin-1")
    return ""


def _client_host(scope: Scope) -> str:
    client = scope.get("client")
    if not client:
        return ""
    return str(client[0])


def _json_response(send: Send, status: int, body: dict, request_id: str, extra: list[tuple[bytes, bytes]] | None = None):
    raw = json.dumps(body).encode("utf-8")
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(raw)).encode()),
        (b"x-request-id", request_id.encode()),
        *_SECURITY,
        (b"cache-control", b"no-store"),
        (b"server", b"surf"),
    ]
    if extra:
        headers.extend(extra)

    async def _send() -> None:
        await send({"type": "http.response.start", "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": raw})

    return _send()


class SurfGuard:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        configure()
        request_id = _header(scope, "x-request-id")
        if not request_id or len(request_id) > 80 or any(c.isspace() for c in request_id):
            request_id = uuid.uuid4().hex
        state = scope.setdefault("state", {})
        state["request_id"] = request_id
        path = scope.get("path") or ""
        method = scope.get("method") or ""
        started = time.perf_counter()
        status_holder = {"status": 500}

        length = _header(scope, "content-length")
        if length.isdigit() and int(length) > settings.max_body_bytes:
            LOG.info(
                "request body too large",
                extra={"request_id": request_id, "method": method, "path": path, "status": 413},
            )
            await _json_response(
                send,
                413,
                error_payload("Request body is too large.", "payload_too_large", request_id),
                request_id,
            )
            return

        if method == "POST" and (path.startswith("/v1/auth") or path == "/v1/admin/login"):
            # Validation runs inside the app, so this is the only IP ceiling that
            # covers malformed bodies. Build a tiny request-like shim.
            try:
                rate_limit(
                    _ScopeRequest(scope),
                    client_bucket(_ScopeRequest(scope), "auth-post"),
                    limit=settings.auth_ip_rate_limit,
                    window_seconds=float(settings.auth_ip_rate_window_seconds),
                )
            except Exception as exc:
                from fastapi import HTTPException

                if isinstance(exc, HTTPException) and exc.status_code == 429:
                    LOG.info(
                        "auth post rate limited",
                        extra={"request_id": request_id, "method": method, "path": path, "status": 429},
                    )
                    await _json_response(
                        send,
                        429,
                        error_payload(RATE_LIMIT_DETAIL, "rate_limited", request_id),
                        request_id,
                    )
                    return
                raise

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message["status"])
                headers = list(message.get("headers") or [])
                existing = {key.lower() for key, _ in headers}
                headers.append((b"x-request-id", request_id.encode()))
                for key, value in _SECURITY:
                    if key not in existing:
                        headers.append((key, value))
                if path.startswith("/v1/auth") or path.startswith("/v1/admin"):
                    headers.append((b"cache-control", b"no-store"))
                # Hide gunicorn/uvicorn version strings.
                headers = [(b"server", b"surf") if key.lower() == b"server" else (key, value) for key, value in headers]
                if b"server" not in {key.lower() for key, _ in headers}:
                    headers.append((b"server", b"surf"))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            status = status_holder["status"]
            extra = {
                "request_id": request_id,
                "method": method,
                "path": path,
                "status": status,
                "duration_ms": duration_ms,
                "client_ip": _client_host(scope) or "unknown",
            }
            if path in _HEALTH and status < 400:
                LOG.debug("request", extra=extra)
            elif status >= 500:
                LOG.error("request", extra=extra)
            else:
                LOG.info("request", extra=extra)


class _ScopeRequest:
    """Just enough of a Request for client_ip() / rate_limit()."""

    def __init__(self, scope: Scope) -> None:
        self.scope = scope
        self.headers = _HeaderMap(scope)
        client = scope.get("client")
        self.client = _Client(client[0]) if client else None


class _Client:
    def __init__(self, host: str) -> None:
        self.host = host


class _HeaderMap:
    def __init__(self, scope: Scope) -> None:
        self._scope = scope

    def get(self, name: str, default: str = "") -> str:
        return _header(self._scope, name) or default
