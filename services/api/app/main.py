"""Surf AI API: health, model registry, pack manifest, and a SearXNG proxy.

Privacy: search query text is never stored. Page text is returned to the device
and not written to Postgres. Device JWTs from /v1/devices/register are temporary
until Step 5 login; they are not rows in `devices` because that table requires a user.
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
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .limiter import MemoryLimiter, RedisLimiter
from .pages import fetch_one
from .ssrf import SsrfBlocked
from .tokens import issue_device_token, read_bearer

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


def current_user(authorization: str = Header(default="")) -> dict:
    try:
        return read_bearer(authorization)
    except Exception as exc:  # noqa: BLE001
        code = "unauthenticated" if "missing" in str(exc) else "invalid_token"
        raise Problem(401, code, "missing bearer token" if code == "unauthenticated" else "invalid token") from exc


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


class RegisterIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)


@app.post("/v1/devices/register")
async def register_device(request: Request, body: RegisterIn | None = None):
    host = request.client.host if request.client else "unknown"
    status, retry = await app.state.limiter.hit(f"register:{host}")
    if status != "ok":
        raise Problem(429, "rate_limited", "too many device registrations", retry_after=retry or 60)
    # Temporary: not inserted into devices (that row needs a user). Step 5 will.
    return issue_device_token()


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
        if not page["parts"]:
            errors.append({"url": url, "code": "empty"})
            continue
        for part in page["parts"]:
            chunks.append({
                "url": page["url"],
                "title": page["title"],
                "published": page["published"],
                "text": part,
            })
    await remember(user, None, len(chunks), 0, "ok")
    return {"chunks": chunks, "errors": errors}
