"""Tests for the Valkey-backed entry rate limiter (replaces the removed host limiter)."""
from __future__ import annotations

import os
import time

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["MAIL_MODE"] = "console"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.rate_limit import RateLimiter, client_ip  # noqa: E402
from app.tokens import issue_access_token  # noqa: E402


class _FakeKV:
    """Minimal async stand-in for redis.asyncio (INCR/EXPIRE/TTL)."""

    def __init__(self):
        self.counts: dict[str, int] = {}
        self.ttls: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key: str, seconds: int) -> bool:
        self.ttls[key] = seconds
        return True

    async def ttl(self, key: str) -> int:
        return self.ttls.get(key, -1)


# ---- RateLimiter unit behaviour ------------------------------------------


@pytest.mark.asyncio
async def test_memory_limiter_allows_up_to_limit_then_blocks():
    lim = RateLimiter(kv=None)
    for _ in range(3):
        allowed, retry = await lim.hit("user:a", 3)
        assert allowed and retry == 0
    allowed, retry = await lim.hit("user:a", 3)
    assert not allowed
    assert 1 <= retry <= 60


@pytest.mark.asyncio
async def test_memory_limiter_buckets_are_independent():
    lim = RateLimiter(kv=None)
    await lim.hit("user:a", 1)
    allowed, _ = await lim.hit("user:b", 1)
    assert allowed


@pytest.mark.asyncio
async def test_zero_or_negative_limit_disables_bucket():
    lim = RateLimiter(kv=None)
    for _ in range(5):
        allowed, _ = await lim.hit("user:a", 0)
        assert allowed


@pytest.mark.asyncio
async def test_valkey_limiter_increments_and_expires():
    kv = _FakeKV()
    lim = RateLimiter(kv=kv)
    for _ in range(2):
        allowed, _ = await lim.hit("user:a", 2)
        assert allowed
    allowed, retry = await lim.hit("user:a", 2)
    assert not allowed and retry >= 1
    # window expiry was set on first write; key is namespaced and windowed
    assert any(k.startswith("rl:user:a:") for k in kv.counts)
    assert kv.ttls  # EXPIRE applied


@pytest.mark.asyncio
async def test_valkey_limiter_reports_ttl_retry_after():
    kv = _FakeKV()
    lim = RateLimiter(kv=kv)
    await lim.hit("ip:1.2.3.4", 1)
    # force the second hit over the limit with a known TTL
    key = f"rl:ip:1.2.3.4:{int(time.time()) // lim.window}"
    kv.ttls[key] = 42
    allowed, retry = await lim.hit("ip:1.2.3.4", 1)
    assert not allowed and retry == 42


# ---- client_ip precedence --------------------------------------------------


class _Req:
    def __init__(self, headers, host):
        self.headers = headers
        self.client = type("C", (), {"host": host})()


def test_client_ip_prefers_forwarded_for_real_ip_then_socket():
    assert client_ip(_Req({"x-forwarded-for": "203.0.113.7, 70.41.3.18"}, "10.0.0.1")) == "203.0.113.7"
    assert client_ip(_Req({"x-real-ip": "198.51.100.9"}, "10.0.0.1")) == "198.51.100.9"
    assert client_ip(_Req({}, "10.0.0.1")) == "10.0.0.1"
    assert client_ip(_Req({}, None)) == "unknown"


# ---- route integration (429 wiring) ---------------------------------------


def test_chat_route_returns_429_when_user_bucket_exhausted(monkeypatch):
    import app.gateway.router as router_mod

    monkeypatch.setattr(router_mod, "CHAT_RATE_PER_MINUTE", 1)
    with TestClient(app) as client:
        uid = "user-rate-limit-test"
        token = issue_access_token("dev-1", uid, "rl@example.com")["token"]
        # Pre-seed the in-memory bucket so the very first guarded call trips.
        app.state.limiter._events[f"chat:user:{uid}"] = [int(time.time())]
        resp = client.post(
            "/api/v1/chat",
            json={"model": "openai/gpt-4.1", "prompt": "hi", "stream": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 429
        assert resp.headers.get("Retry-After")


def test_otp_start_ip_bucket_trips_429(monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(main_mod, "OTP_IP_RATE_PER_MINUTE", 2)
    with TestClient(app) as client:
        codes = []
        for i in range(2):
            r = client.post("/v1/auth/otp/start", json={"email": f"rl{i}@example.com"})
            codes.append(r.status_code)
        assert codes == [200, 200]
        third = client.post("/v1/auth/otp/start", json={"email": "rl2@example.com"})
        assert third.status_code == 429
        assert third.json()["error"]["code"] == "rate_limited"
