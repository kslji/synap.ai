"""Surf AI API (MVP slice): health, version, model registry, pack manifest, web-search proxy.
Auth: Bearer JWT verified with the Supabase JWT secret (HS256). Privacy: search query text is never stored."""
import os, time, json, pathlib, datetime as dt
from contextlib import asynccontextmanager

import httpx, jwt, redis.asyncio as redis
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg_pool import AsyncConnectionPool
from pydantic import BaseModel, Field

ENV = os.environ
REGISTRY = json.loads((pathlib.Path(__file__).parent / "models.registry.json").read_text())


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pg = AsyncConnectionPool(ENV["DATABASE_URL"], min_size=1, max_size=5, open=False)
    await app.state.pg.open()
    app.state.kv = redis.from_url(ENV["VALKEY_URL"])
    app.state.http = httpx.AsyncClient(timeout=8)
    yield
    await app.state.http.aclose(); await app.state.kv.aclose(); await app.state.pg.close()

app = FastAPI(title="Surf AI API", version="0.1.0", lifespan=lifespan)


class Problem(Exception):
    def __init__(self, status: int, code: str, detail: str, retry_after: int | None = None):
        self.status, self.code, self.detail, self.retry_after = status, code, detail, retry_after

@app.exception_handler(Problem)
async def problem_handler(_: Request, p: Problem):
    headers = {"Retry-After": str(p.retry_after)} if p.retry_after else None
    return JSONResponse({"error": {"code": p.code, "message": p.detail}}, status_code=p.status, headers=headers)


def current_user(authorization: str = Header(default="")) -> dict:
    if not authorization.startswith("Bearer "):
        raise Problem(401, "unauthenticated", "missing bearer token")
    try:
        return jwt.decode(authorization[7:], ENV["JWT_SECRET"], algorithms=["HS256"], audience=ENV.get("JWT_AUDIENCE", "authenticated"))
    except jwt.PyJWTError as e:
        raise Problem(401, "invalid_token", str(e))


async def rate_limit(user: dict = Depends(current_user)) -> dict:
    kv, sub, now = app.state.kv, user["sub"], int(time.time())
    minute_key, day_key = f"rl:s:{sub}:{now // 60}", f"rl:d:{sub}:{dt.date.today().isoformat()}"
    pipe = kv.pipeline(); pipe.incr(minute_key); pipe.expire(minute_key, 70); pipe.incr(day_key); pipe.expire(day_key, 90000)
    per_min, _, per_day, _ = await pipe.execute()
    if per_min > int(ENV.get("SEARCH_PER_MIN", 10)):
        raise Problem(429, "rate_limited", "too many searches this minute", retry_after=60 - now % 60)
    if per_day > int(ENV.get("SEARCH_PER_DAY", 100)):
        raise Problem(429, "quota_exceeded", "daily web-search quota used", retry_after=3600)
    return user


@app.get("/v1/health")
async def health():
    out = {}
    try:
        async with app.state.pg.connection() as c:
            row = await (await c.execute("select extversion from pg_extension where extname='vector'")).fetchone()
        out["postgres"] = f"ok (pgvector {row[0]})"
    except Exception as e:  # noqa: BLE001
        out["postgres"] = f"error: {e.__class__.__name__}"
    try:
        out["valkey"] = "ok" if await app.state.kv.ping() else "error"
    except Exception as e:  # noqa: BLE001
        out["valkey"] = f"error: {e.__class__.__name__}"
    try:
        r = await app.state.http.get(ENV["SEARXNG_URL"].rsplit("/", 1)[0] + "/healthz")
        out["searxng"] = "ok" if r.status_code == 200 else f"http {r.status_code}"
    except Exception as e:  # noqa: BLE001
        out["searxng"] = f"error: {e.__class__.__name__}"
    ok = all(v.startswith("ok") for v in out.values())
    return JSONResponse({"status": "ok" if ok else "degraded", **out}, status_code=200 if ok else 503)


@app.get("/v1/version")
async def version():
    return {"min_app_version": ENV.get("MIN_APP_VERSION", "0.1.0"), "announcements": []}


@app.get("/v1/models/registry")
async def models_registry():
    return REGISTRY  # production: serve the Ed25519-signed file from R2 instead


@app.get("/v1/packs/manifest")
async def packs_manifest(installed: str = "", user: dict = Depends(current_user)):
    have = dict(p.split("@", 1) for p in installed.split(",") if "@" in p)
    async with app.state.pg.connection() as c:
        rows = await (await c.execute(
            """select distinct on (pack_id) pack_id, version, size_bytes, manifest, encode(signature,'base64'), signing_key_id
               from pack_versions where status='published' order by pack_id, published_at desc""")).fetchall()
    packs = [{"pack_id": r[0], "version": r[1], "size_bytes": r[2], "manifest": r[3], "signature": r[4], "key_id": r[5],
              "update_available": have.get(r[0]) != r[1]} for r in rows]
    return {"packs": packs, "generated_at": dt.datetime.now(dt.UTC).isoformat()}


class SearchIn(BaseModel):
    q: str = Field(min_length=1, max_length=300)
    lang: str = "en"
    time_range: str | None = Field(default=None, pattern="^(day|month|year)$")
    agent_id: str | None = None


@app.post("/v1/search")
async def search(req: SearchIn, user: dict = Depends(rate_limit)):
    t0 = time.perf_counter()
    params = {"q": req.q, "format": "json", "language": req.lang, "safesearch": 1, "pageno": 1}
    if req.time_range:
        params["time_range"] = req.time_range
    try:
        r = await app.state.http.get(ENV["SEARXNG_URL"], params=params)
        r.raise_for_status()
        raw = r.json().get("results", [])
        status = "ok"
    except (httpx.HTTPError, ValueError):
        raw, status = [], "upstream_error"
    results = [{"title": x.get("title"), "url": x.get("url"), "snippet": (x.get("content") or "")[:500],
                "engine": x.get("engine"), "published": x.get("publishedDate")} for x in raw[:8]]
    latency = int((time.perf_counter() - t0) * 1000)
    async with app.state.pg.connection() as c:   # privacy_mode=true -> query_text stays NULL
        await c.execute("insert into search_requests(privacy_mode, agent_id, result_count, latency_ms, status) values (true,%s,%s,%s,%s)",
                        (req.agent_id, len(results), latency, status))
    if status != "ok":
        raise Problem(502, "search_unavailable", "web search upstream failed", retry_after=10)
    return {"results": results, "latency_ms": latency}
