"""Surf AI API: login, devices, pack catalog, and a SearXNG proxy.

Privacy: search query text is never stored. Page text is returned to the device
and not written to Postgres. Access tokens are minted at email login. `sub` is
the device id so search rate limits stay per device.
"""
import datetime as dt
import hashlib
import json
import os
import pathlib
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, Header, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .auth_store import AuthError, MemoryAuth, PostgresAuth
from .limiter import MemoryLimiter, RedisLimiter
from .mailer import make_mail
from .pack_catalog import catalog, verify_download
from .pages import fetch_one
from .ssrf import SsrfBlocked
from .tokens import issue_access_token, read_bearer

ENV = os.environ
REGISTRY = json.loads((pathlib.Path(__file__).parent / "models.registry.json").read_text())
LITE = ENV.get("SURF_API_LITE") == "1" or not ENV.get("DATABASE_URL")
CACHE_TTL = int(ENV.get("SEARCH_CACHE_TTL", "600"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.lite = LITE
    app.state.pg = None
    app.state.audit: list[dict] = []
    app.state.memory_cache: dict[str, tuple[float, dict]] = {}
    per_min = int(ENV.get("SEARCH_PER_MIN", "10"))
    per_day = int(ENV.get("SEARCH_PER_DAY", "100"))
    if LITE:
        app.state.kv = None
        app.state.limiter = MemoryLimiter(per_min, per_day)
    else:
        import redis.asyncio as redis
        from psycopg_pool import AsyncConnectionPool

        app.state.pg = AsyncConnectionPool(ENV["DATABASE_URL"], min_size=1, max_size=5, open=False)
        await app.state.pg.open()
        app.state.kv = redis.from_url(ENV["VALKEY_URL"])
        app.state.limiter = RedisLimiter(app.state.kv, per_min, per_day)
    app.state.mail = make_mail()
    if LITE:
        app.state.auth = MemoryAuth()
    else:
        app.state.auth = PostgresAuth(app.state.pg)
        await app.state.auth.ensure_schema()
    app.state.http = httpx.AsyncClient(timeout=8)
    yield
    await app.state.http.aclose()
    if app.state.kv is not None:
        await app.state.kv.aclose()
    if app.state.pg is not None:
        await app.state.pg.close()


app = FastAPI(title="Surf AI API", version="0.1.0", lifespan=lifespan)


class Problem(Exception):
    def __init__(self, status: int, code: str, detail: str, retry_after: int | None = None):
        self.status, self.code, self.detail, self.retry_after = status, code, detail, retry_after


@app.exception_handler(Problem)
async def problem_handler(_: Request, problem: Problem):
    headers = {"Retry-After": str(problem.retry_after)} if problem.retry_after else None
    return JSONResponse({"error": {"code": problem.code, "message": problem.detail}}, status_code=problem.status, headers=headers)


async def current_user(authorization: str = Header(default="")) -> dict:
    try:
        claims = read_bearer(authorization)
    except Exception as exc:  # noqa: BLE001
        code = "unauthenticated" if "missing" in str(exc) else "invalid_token"
        raise Problem(401, code, "missing bearer token" if code == "unauthenticated" else "invalid token") from exc
    if claims.get("typ") != "access" or not await app.state.auth.device_active(str(claims.get("sub") or "")):
        raise Problem(401, "invalid_token", "invalid token")
    return claims


async def rate_limit(request: Request, user: dict = Depends(current_user)) -> dict:
    status, retry = await app.state.limiter.hit(str(user["sub"]))
    if status != "ok":
        code = "rate_limited" if status == "rate_limited" else "quota_exceeded"
        detail = "too many searches this minute" if status == "rate_limited" else "daily web-search quota used"
        raise Problem(429, code, detail, retry_after=retry or 60)
    request.state.user = user
    return user


def allow_hosts() -> set[str]:
    return {item.strip().lower() for item in ENV.get("FETCH_ALLOW_HOSTS", "").split(",") if item.strip()}


@app.get("/v1/health")
async def health():
    out: dict[str, str] = {}
    if app.state.lite:
        out["postgres"] = "skipped"
        out["valkey"] = "memory"
    else:
        try:
            async with app.state.pg.connection() as conn:
                row = await (await conn.execute("select extversion from pg_extension where extname='vector'")).fetchone()
            out["postgres"] = f"ok (pgvector {row[0]})"
        except Exception as exc:  # noqa: BLE001
            out["postgres"] = f"error: {exc.__class__.__name__}"
        try:
            out["valkey"] = "ok" if await app.state.kv.ping() else "error"
        except Exception as exc:  # noqa: BLE001
            out["valkey"] = f"error: {exc.__class__.__name__}"
    try:
        base = ENV["SEARXNG_URL"].rsplit("/", 1)[0]
        response = await app.state.http.get(base + "/healthz")
        out["searxng"] = "ok" if response.status_code == 200 else f"http {response.status_code}"
    except Exception as exc:  # noqa: BLE001
        out["searxng"] = f"error: {exc.__class__.__name__}"
    ok = all(value.startswith("ok") or value in {"skipped", "memory"} for value in out.values())
    return JSONResponse({"status": "ok" if ok else "degraded", **out}, status_code=200 if ok else 503)


@app.get("/v1/version")
async def version():
    return {"min_app_version": ENV.get("MIN_APP_VERSION", "0.1.0"), "announcements": []}


@app.get("/v1/models/registry")
async def models_registry():
    return REGISTRY


@app.get("/v1/packs/manifest")
async def packs_manifest(installed: str = "", user: dict = Depends(current_user)):
    if app.state.lite or app.state.pg is None:
        return {"packs": [], "generated_at": dt.datetime.now(dt.UTC).isoformat()}
    have = dict(part.split("@", 1) for part in installed.split(",") if "@" in part)
    async with app.state.pg.connection() as conn:
        rows = await (await conn.execute(
            """select distinct on (pack_id) pack_id, version, size_bytes, manifest, encode(signature,'base64'), signing_key_id
               from pack_versions where status='published' order by pack_id, published_at desc""")).fetchall()
    packs = [{"pack_id": row[0], "version": row[1], "size_bytes": row[2], "manifest": row[3], "signature": row[4], "key_id": row[5],
              "update_available": have.get(row[0]) != row[1]} for row in rows]
    return {"packs": packs, "generated_at": dt.datetime.now(dt.UTC).isoformat()}


class OtpStartIn(BaseModel):
    email: str = Field(max_length=200)


class DeviceIn(BaseModel):
    device_uid: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, max_length=80)
    os: str = "linux"
    arch: str = "x64"
    app_version: str = "0.1.0"


class OtpVerifyIn(BaseModel):
    email: str = Field(max_length=200)
    code: str = Field(max_length=12)
    device: DeviceIn = DeviceIn()


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=500)


def _auth_problem(error: AuthError) -> Problem:
    return Problem(error.status, error.code, error.detail, error.retry_after)


def _session(user: dict, device: dict, refresh: str) -> dict:
    access = issue_access_token(device["id"], user["id"], user["email"])
    return {
        "access_token": access["token"],
        "token_type": access["token_type"],
        "expires_in": access["expires_in"],
        "refresh_token": refresh,
        "user": {"id": user["id"], "email": user["email"]},
        "device": {"id": device["id"], "device_uid": device["device_uid"], "name": device["name"], "os": device["os"]},
    }


@app.post("/v1/auth/otp/start")
async def otp_start(body: OtpStartIn):
    try:
        code = await app.state.auth.request_code(body.email)
    except AuthError as exc:
        raise _auth_problem(exc) from exc
    except ValueError as exc:
        raise Problem(400, "invalid_email", "Enter a valid email address.") from exc
    app.state.mail.send(
        body.email.strip().lower(),
        "Your Surf AI code",
        f"Your Surf AI sign-in code is {code}. It expires in 10 minutes.",
        code,
    )
    out = {"ok": True}
    if os.environ.get("MAIL_MODE", "console") != "smtp":
        out["dev_code"] = code
    return out


@app.post("/v1/auth/otp/verify")
async def otp_verify(body: OtpVerifyIn):
    try:
        user = await app.state.auth.verify_code(body.email, body.code)
        device = await app.state.auth.activate_device(user, body.device.model_dump())
        refresh, _family = await app.state.auth.issue_refresh(user["id"], device["id"])
    except AuthError as exc:
        raise _auth_problem(exc) from exc
    except ValueError as exc:
        raise Problem(400, "invalid_email", "Enter a valid email address.") from exc
    return _session(user, device, refresh)


@app.post("/v1/auth/refresh")
async def refresh_session(body: RefreshIn):
    try:
        refresh, user, device = await app.state.auth.rotate_refresh(body.refresh_token)
    except AuthError as exc:
        raise _auth_problem(exc) from exc
    return _session(user, device, refresh)


@app.post("/v1/auth/logout")
async def logout(body: RefreshIn):
    await app.state.auth.revoke_refresh(body.refresh_token)
    return {"ok": True}


@app.get("/v1/account")
async def account(user: dict = Depends(current_user)):
    row = await app.state.auth.user_by_id(str(user["uid"]))
    if not row:
        raise Problem(401, "invalid_token", "invalid token")
    return {"id": row["id"], "email": row["email"]}


@app.get("/v1/devices")
async def devices(user: dict = Depends(current_user)):
    rows = await app.state.auth.list_devices(str(user["uid"]))
    return {"devices": rows}


@app.post("/v1/devices/{device_id}/revoke")
async def revoke_device(device_id: str, user: dict = Depends(current_user)):
    ok = await app.state.auth.revoke_device(str(user["uid"]), device_id)
    if not ok:
        raise Problem(404, "not_found", "That device is not active.")
    return {"ok": True}


@app.post("/v1/devices/register")
async def register_device():
    raise Problem(410, "gone", "Sign in with an email code. Device registration now happens at login.")


@app.get("/v1/packs")
async def packs(request: Request, installed: str = "", user: dict = Depends(current_user)):
    base = os.environ.get("PUBLIC_BASE_URL") or str(request.base_url).rstrip("/")
    return catalog(base, installed)


@app.get("/v1/packs/download")
async def pack_download(path: str, exp: int, sig: str):
    try:
        full = verify_download(path, exp, sig)
    except ValueError as exc:
        raise Problem(403, "forbidden", "That download link is not valid.") from exc
    return FileResponse(full)


class SearchIn(BaseModel):
    query: str | None = Field(default=None, max_length=300)
    q: str | None = Field(default=None, max_length=300)
    k: int = Field(default=8, ge=1, le=8)
    niche: str | None = Field(default=None, max_length=64)
    domains: list[str] = Field(default_factory=list, max_length=8)
    lang: str = "en"
    time_range: str | None = Field(default=None, pattern="^(day|month|year)$")
    agent_id: str | None = None

    def text(self) -> str:
        value = (self.query or self.q or "").strip()
        if not value:
            raise Problem(422, "invalid_query", "query is empty")
        return value[:300]


def cache_key(text: str, body: SearchIn) -> str:
    raw = json.dumps({
        "q": text.casefold(), "k": body.k, "d": sorted(body.domains),
        "l": body.lang, "t": body.time_range, "n": body.niche,
    }, sort_keys=True)
    return "search:" + hashlib.sha256(raw.encode()).hexdigest()


def host_of(url: str) -> str:
    from urllib.parse import urlsplit
    return (urlsplit(url).hostname or "").lower()


@app.post("/v1/search")
async def search(body: SearchIn, user: dict = Depends(rate_limit)):
    text = body.text()
    started = time.perf_counter()
    key = cache_key(text, body)
    cached = await read_cache(key)
    if cached is not None:
        results = filter_domains(cached, body.domains)[:body.k]
        await remember(user, body.agent_id, len(results), int((time.perf_counter() - started) * 1000), "ok")
        return {"results": results, "latency_ms": int((time.perf_counter() - started) * 1000), "cached": True}
    params = {"q": text, "format": "json", "language": body.lang, "safesearch": 1, "pageno": 1}
    if body.time_range:
        params["time_range"] = body.time_range
    if body.niche:
        params["q"] = f"{text} {body.niche}".strip()
    try:
        response = await app.state.http.get(ENV["SEARXNG_URL"], params=params)
        response.raise_for_status()
        raw = response.json().get("results", [])
        status = "ok"
    except (httpx.HTTPError, ValueError):
        raw, status = [], "upstream_error"
    results = []
    for item in raw:
        url = item.get("url") or ""
        if not url.startswith("http://") and not url.startswith("https://"):
            continue
        results.append({
            "title": item.get("title") or url,
            "url": url,
            "snippet": (item.get("content") or "")[:500],
            "published": item.get("publishedDate"),
        })
    results = filter_domains(results, body.domains)[:body.k]
    if status == "ok":
        await write_cache(key, results)
    latency = int((time.perf_counter() - started) * 1000)
    await remember(user, body.agent_id, len(results), latency, status)
    if status != "ok":
        raise Problem(502, "search_unavailable", "web search upstream failed", retry_after=10)
    return {"results": results, "latency_ms": latency, "cached": False}


def filter_domains(results: list[dict], domains: list[str]) -> list[dict]:
    if not domains:
        return results
    suffixes = [item.lower().lstrip(".") for item in domains]
    kept = []
    for item in results:
        host = host_of(item.get("url") or "")
        if any(host == suffix or host.endswith("." + suffix) for suffix in suffixes):
            kept.append(item)
    return kept


async def read_cache(key: str) -> list[dict] | None:
    if app.state.kv is not None:
        raw = await app.state.kv.get(key)
        if not raw:
            return None
        return json.loads(raw)
    hit = app.state.memory_cache.get(key)
    if not hit or hit[0] < time.time():
        return None
    return hit[1]


async def write_cache(key: str, results: list[dict]) -> None:
    if app.state.kv is not None:
        await app.state.kv.set(key, json.dumps(results), ex=CACHE_TTL)
        return
    app.state.memory_cache[key] = (time.time() + CACHE_TTL, results)


async def remember(user: dict, agent_id: str | None, count: int, latency: int, status: str) -> None:
    # privacy_mode is always true: query_text is not a column we fill.
    record = {"result_count": count, "latency_ms": latency, "status": status, "agent_id": agent_id, "query_text": None}
    if app.state.lite:
        app.state.audit.append(record)
        return
    async with app.state.pg.connection() as conn:
        await conn.execute(
            "insert into search_requests(privacy_mode, agent_id, result_count, latency_ms, status) values (true,%s,%s,%s,%s)",
            (agent_id, count, latency, status),
        )


class FetchIn(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=5)


@app.post("/v1/fetch")
async def fetch_pages(body: FetchIn, user: dict = Depends(rate_limit)):
    chunks = []
    errors = []
    sanitizer = []
    ignored = []
    allow = allow_hosts()
    for url in body.urls:
        try:
            page = await fetch_one(app.state.http, url, allow)
        except SsrfBlocked as exc:
            errors.append({"url": url, "code": exc.reason})
            continue
        except (httpx.HTTPError, OSError):
            errors.append({"url": url, "code": "fetch"})
            continue
        sanitizer.append({"url": page["url"], "report": page.get("sanitizer") or {}})
        for item in page.get("ignored") or []:
            ignored.append({"url": page["url"], "score": item.get("score", 0), "flags": item.get("flags") or []})
        if not page["parts"]:
            errors.append({"url": url, "code": "empty"})
            continue
        for part in page["parts"]:
            chunks.append({
                "url": page["url"],
                "title": page["title"],
                "published": page["published"],
                "text": part,
                "injection": page.get("injection") or {"action": "keep", "score": 0, "flags": []},
            })
    await remember(user, None, len(chunks), 0, "ok")
    return {"chunks": chunks, "errors": errors, "sanitizer": sanitizer, "ignored": ignored}
