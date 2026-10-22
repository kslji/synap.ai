"""Valkey-backed fixed-window rate limiter for HTTP entry points.

Replaces the per-user limiter that left the repo with the legacy auth host.
Guarded routes: the gateway chat endpoint and the auth/OTP endpoints.

Each request consumes one count from a per-user bucket and a per-IP bucket over a
one-minute window; over the limit the caller returns 429 with a Retry-After. The
counters live in Valkey (INCR + EXPIRE) so limits hold across workers and restarts.
In LITE/dev mode (no Valkey) an in-memory sliding window is used instead.
"""
from __future__ import annotations

import os
import time
from typing import Protocol

from fastapi import Request

# Per-minute HTTP entry limits (per user + per IP). Read once at import; the
# drift guard requires each of these to appear in deploy/.env.example.
CHAT_RATE_PER_MINUTE = int(os.environ.get("CHAT_RATE_PER_MINUTE", "30"))
CHAT_IP_RATE_PER_MINUTE = int(os.environ.get("CHAT_IP_RATE_PER_MINUTE", "60"))
OTP_RATE_PER_MINUTE = int(os.environ.get("OTP_RATE_PER_MINUTE", "10"))
OTP_IP_RATE_PER_MINUTE = int(os.environ.get("OTP_IP_RATE_PER_MINUTE", "20"))


class _KV(Protocol):
    async def incr(self, key: str) -> int: ...
    async def expire(self, key: str, seconds: int) -> bool: ...
    async def ttl(self, key: str) -> int: ...


class RateLimiter:
    """Fixed-window counter limiter (per user + per IP) over Valkey."""

    def __init__(self, kv: _KV | None, window: int = 60):
        self.kv = kv
        self.window = window
        # In-memory fallback for LITE/dev: key -> list of hit timestamps.
        self._events: dict[str, list[int]] = {}

    async def hit(self, bucket: str, limit: int) -> tuple[bool, int]:
        """Consume one count for ``bucket`` against ``limit``.

        Returns ``(allowed, retry_after_seconds)``. ``retry_after`` is 0 when
        allowed. ``limit <= 0`` disables the limit for this bucket.
        """
        if limit <= 0:
            return True, 0
        now = int(time.time())
        if self.kv is not None:
            key = f"rl:{bucket}:{now // self.window}"
            count = await self.kv.incr(key)
            if count == 1:
                await self.kv.expire(key, self.window)
            if count > limit:
                ttl = await self.kv.ttl(key)
                return False, max(ttl if ttl > 0 else self.window, 1)
            return True, 0
        return self._hit_memory(bucket, limit, now)

    def _hit_memory(self, bucket: str, limit: int, now: int) -> tuple[bool, int]:
        kept = [stamp for stamp in self._events.get(bucket, []) if now - stamp < self.window]
        if len(kept) >= limit:
            self._events[bucket] = kept
            return False, max(1, self.window - (now - kept[0]))
        kept.append(now)
        self._events[bucket] = kept
        return True, 0


def client_ip(request: Request) -> str:
    """Best-effort client IP behind the Caddy reverse proxy.

    Caddy sets X-Forwarded-For; the leftmost entry is the original client. Falls
    back to X-Real-IP then the direct socket peer. Assumes a trusted proxy (the
    shipped deployment always runs behind Caddy)."""
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    real = request.headers.get("x-real-ip", "")
    if real:
        return real.strip()
    host = request.client.host if request.client else None
    return host or "unknown"
