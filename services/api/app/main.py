"""Surf AI API: email-OTP login, devices, pack catalog, and the OpenRouter gateway.

Privacy: all chat history and code stay on the device; this backend stores only
auth, usage, credits and routing. Access tokens are minted at email login. `sub`
is the device id so limits stay per device. There is no web search: Online chat
calls the gateway model directly.
"""
import datetime as dt
import hmac
import json
import logging
import os
import pathlib
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .auth_store import AuthError, MemoryAuth, PostgresAuth
from .licence_store import MemoryLicences, PostgresLicences
from .licences import ActivationWindow, LicenceError, activate as activate_licence
from .licences import apply_webhook, deactivate as deactivate_licence, list_devices as list_licence_devices, refresh as refresh_licence, renew as renew_licence
from .licences import verify_razorpay, verify_stripe
from .mailer import make_mail
from .content_key import sealed_for_user
from .pack_catalog import catalog, verify_download
from .rate_limit import (
    OTP_IP_RATE_PER_MINUTE,
    OTP_RATE_PER_MINUTE,
    RateLimiter,
    client_ip,
)
from .cors import cors_kwargs
from .startup_guard import is_production, validate_production_config
from .tokens import issue_access_token, read_bearer
from .version import app_version
from .gateway.store import MemoryGatewayStore, PostgresGatewayStore
from .gateway.service import GatewayService
from .gateway.router import router as gateway_router

log = logging.getLogger("surf.api")
ENV = os.environ
REGISTRY = json.loads((pathlib.Path(__file__).parent / "models.registry.json").read_text())
LITE = ENV.get("SURF_API_LITE") == "1" or not ENV.get("DATABASE_URL")


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_production_config()
    app.state.lite = LITE
    app.state.pg = None
    if LITE:
        app.state.kv = None
    else:
        import redis.asyncio as redis
        from psycopg_pool import AsyncConnectionPool

        app.state.pg = AsyncConnectionPool(ENV["DATABASE_URL"], min_size=1, max_size=5, open=False)
        await app.state.pg.open()
        app.state.kv = redis.from_url(ENV["VALKEY_URL"])
    app.state.mail = make_mail()
    if LITE:
        app.state.auth = MemoryAuth()
        app.state.licences = MemoryLicences()
    else:
        app.state.auth = PostgresAuth(app.state.pg)
        await app.state.auth.ensure_schema()
        app.state.licences = PostgresLicences(app.state.pg)
        await app.state.licences.ensure_schema()
    app.state.activation_limiter = ActivationWindow(
        int(ENV.get("ACTIVATION_LIMIT", "8")),
        int(ENV.get("ACTIVATION_WINDOW", "600")),
    )
    app.state.http = httpx.AsyncClient(timeout=8)
    # Valkey-backed limiter; falls back to an in-memory window when kv is None (LITE).
    app.state.limiter = RateLimiter(app.state.kv)
    
    # Initialize gateway service
    if LITE:
        app.state.gateway_store = MemoryGatewayStore()
    else:
        app.state.gateway_store = PostgresGatewayStore(app.state.pg)
        await app.state.gateway_store.ensure_schema()
    
    app.state.gateway = GatewayService(
        store=app.state.gateway_store,
        http_client=app.state.http,
    )
    await app.state.gateway.start()
    
    yield
    await app.state.gateway.stop()
    await app.state.http.aclose()
    if app.state.kv is not None:
        await app.state.kv.aclose()
    if app.state.pg is not None:
        await app.state.pg.close()


app = FastAPI(title="Surf AI API", version=app_version(), lifespan=lifespan)

# CORS is only for named web origins; the desktop app and IDE extension call the
# API natively and need none. Empty CORS_ORIGINS installs no middleware (secure
# default), and a lone "*" is never paired with credentials (see app/cors.py).
_cors = cors_kwargs(ENV.get("CORS_ORIGINS", ""))
if _cors:
    app.add_middleware(CORSMiddleware, **_cors)

# Include routers.
# Authentication is email-OTP only (/v1/auth/otp/* below, backed by PostgresAuth).
# The old MySQL email/password router (/api/v1/auth/*) was removed: it depended on
# a MySQL instance that the Postgres deployment never provisions, so /register
# returned a 500. No client calls it.
app.include_router(gateway_router)


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
    ok = all(value.startswith("ok") or value in {"skipped", "memory"} for value in out.values())
    return JSONResponse({"status": "ok" if ok else "degraded", "version": app_version(), **out}, status_code=200 if ok else 503)


@app.get("/v1/version")
async def version():
    return {"version": app_version(), "min_app_version": ENV.get("MIN_APP_VERSION", "0.1.0"), "announcements": []}


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


async def _limit_auth(identity: str, request: Request) -> None:
    """Per-identity (email/user) + per-IP guard for auth/OTP routes; 429 over limit."""
    limiter: RateLimiter = request.app.state.limiter
    ip = client_ip(request)
    ok, retry = await limiter.hit(f"otp:user:{identity.strip().lower()}", OTP_RATE_PER_MINUTE)
    if not ok:
        raise Problem(429, "rate_limited", "Too many requests. Wait and try again.", retry)
    ok, retry = await limiter.hit(f"otp:ip:{ip}", OTP_IP_RATE_PER_MINUTE)
    if not ok:
        raise Problem(429, "rate_limited", "Too many requests. Wait and try again.", retry)


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
async def otp_start(body: OtpStartIn, request: Request):
    await _limit_auth(body.email, request)
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
    if not is_production() and os.environ.get("MAIL_MODE", "console") != "smtp":
        out["dev_code"] = code
    return out


@app.post("/v1/auth/otp/verify")
async def otp_verify(body: OtpVerifyIn, request: Request):
    await _limit_auth(body.email, request)
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


@app.get("/v1/packs/updates")
async def pack_updates(request: Request, installed: str = "", device_id_hash: str = "", user: dict = Depends(current_user)):
    """Catalog of newer signed packs. An empty stub is returned until packs are published.

    When PACK_CONTENT_KEY_HEX is set and this account's licence is active on
    device_id_hash, content_key_sealed is that key wrapped for the device.
    The raw content key is not in the response.
    """
    base = os.environ.get("PUBLIC_BASE_URL") or str(request.base_url).rstrip("/")
    body = catalog(base, installed)
    sealed = await sealed_for_user(app.state.licences, str(user["uid"]), device_id_hash)
    if body["packs"]:
        return {**body, "stub": False, "interval_hours": 24, "content_key_sealed": sealed}
    return {
        "packs": [],
        "stub": True,
        "interval_hours": 24,
        "content_key_sealed": sealed,
        "note": "No signed knowledge packs are published on this server yet.",
    }


@app.get("/v1/packs/download")
async def pack_download(path: str, exp: int, sig: str):
    try:
        full = verify_download(path, exp, sig)
    except ValueError as exc:
        raise Problem(403, "forbidden", "That download link is not valid.") from exc
    return FileResponse(full)


class LicenceActivateIn(BaseModel):
    device_id_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    key: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, max_length=80)
    os: str = "linux"


class LicenceRefreshIn(BaseModel):
    licence_id: str = Field(min_length=30, max_length=40)
    device_id_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class LicenceDeactivateIn(BaseModel):
    activation_id: str | None = Field(default=None, max_length=40)
    licence_id: str | None = Field(default=None, max_length=40)
    device_id_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class LicenceRevokeIn(BaseModel):
    licence_id: str = Field(min_length=30, max_length=40)
    reason: Literal["revoked", "refunded"] = "revoked"


class LicenceRenewIn(BaseModel):
    licence_id: str = Field(min_length=30, max_length=40)
    term_months: int


def _licence_problem(error: LicenceError) -> Problem:
    return Problem(error.status, error.code, error.detail, error.retry_after)


def _limit_activation(request: Request, device_id_hash: str) -> None:
    ip = request.client.host if request.client else "unknown"
    for bucket in (f"ip:{ip}", f"dev:{device_id_hash}"):
        ok, retry = app.state.activation_limiter.hit(bucket)
        if not ok:
            raise Problem(429, "rate_limited", "Too many activation attempts. Wait and try again.", retry)


async def optional_user(authorization: str = Header(default="")) -> dict | None:
    if not authorization.strip():
        return None
    return await current_user(authorization)


@app.post("/v1/licences/activate")
async def licences_activate(body: LicenceActivateIn, request: Request, user: dict | None = Depends(optional_user)):
    _limit_activation(request, body.device_id_hash)
    account = None
    if user:
        account = await app.state.auth.user_by_id(str(user["uid"]))
        if not account:
            raise Problem(401, "invalid_token", "invalid token")
    try:
        return await activate_licence(app.state.licences, account, body.device_id_hash, body.key, body.name, body.os)
    except LicenceError as exc:
        raise _licence_problem(exc) from exc


@app.post("/v1/licences/refresh")
async def licences_refresh(body: LicenceRefreshIn, request: Request):
    _limit_activation(request, body.device_id_hash)
    try:
        return await refresh_licence(app.state.licences, body.licence_id, body.device_id_hash)
    except LicenceError as exc:
        raise _licence_problem(exc) from exc


@app.post("/v1/licences/deactivate")
async def licences_deactivate(body: LicenceDeactivateIn, user: dict | None = Depends(optional_user)):
    account = None
    if user:
        account = await app.state.auth.user_by_id(str(user["uid"]))
        if not account:
            raise Problem(401, "invalid_token", "invalid token")
    try:
        return await deactivate_licence(app.state.licences, account, body.activation_id, body.licence_id, body.device_id_hash)
    except LicenceError as exc:
        raise _licence_problem(exc) from exc


@app.get("/v1/licences/devices")
async def licences_devices(user: dict = Depends(current_user)):
    return await list_licence_devices(app.state.licences, str(user["uid"]))


@app.post("/v1/licences/revoke")
async def licences_revoke(body: LicenceRevokeIn, x_licence_admin: str = Header(default="")):
    expected = ENV.get("LICENCE_ADMIN_TOKEN", "")
    if not expected:
        raise Problem(503, "unconfigured", "Licence admin token is not set.")
    if len(x_licence_admin) != len(expected) or not hmac.compare_digest(x_licence_admin, expected):
        raise Problem(401, "unauthenticated", "Admin token did not match.")
    row = await app.state.licences.by_id(body.licence_id)
    if not row:
        raise Problem(404, "not_found", "That licence was not found.")
    await app.state.licences.set_status(body.licence_id, body.reason, dt.datetime.now(dt.UTC))
    return {"ok": True, "licence_id": body.licence_id, "status": body.reason}


def _admin_token(header: str) -> None:
    expected = ENV.get("LICENCE_ADMIN_TOKEN", "")
    if not expected:
        raise Problem(503, "unconfigured", "Licence admin token is not set.")
    if len(header) != len(expected) or not hmac.compare_digest(header, expected):
        raise Problem(401, "unauthenticated", "Admin token did not match.")


@app.post("/v1/licences/renew")
async def licences_renew(body: LicenceRenewIn, x_licence_admin: str = Header(default="")):
    _admin_token(x_licence_admin)
    try:
        return await renew_licence(app.state.licences, body.licence_id, body.term_months)
    except LicenceError as exc:
        raise _licence_problem(exc) from exc


def _deliver_key(result: dict) -> dict:
    raw = result.pop("raw_key", None)
    email = result.pop("email", None)
    if raw and email:
        app.state.mail.send(
            email,
            "Your Synap.surf licence",
            f"Your Synap.surf licence key is {raw}. Enter it in the app, or sign in with this email.",
            result.get("key_hint") or "licence",
        )
    if not result.get("dev_key"):
        result.pop("dev_key", None)
    return result


@app.post("/v1/billing/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    secret = ENV.get("STRIPE_WEBHOOK_SECRET", "")
    if not secret:
        raise Problem(503, "unconfigured", "Stripe webhook secret is not set.")
    if not verify_stripe(body, request.headers.get("stripe-signature", ""), secret):
        raise Problem(400, "bad_signature", "Stripe signature did not match.")
    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise Problem(400, "invalid_body", "Stripe body was not JSON.") from exc
    try:
        result = await apply_webhook(app.state.licences, app.state.auth, "stripe", event)
    except LicenceError as exc:
        raise _licence_problem(exc) from exc
    except ValueError as exc:
        raise Problem(400, "invalid_email", "The payment has no email address.") from exc
    return _deliver_key(result)


@app.post("/v1/billing/razorpay")
async def razorpay_webhook(request: Request):
    body = await request.body()
    secret = ENV.get("RAZORPAY_WEBHOOK_SECRET", "")
    if not secret:
        raise Problem(503, "unconfigured", "Razorpay webhook secret is not set.")
    if not verify_razorpay(body, request.headers.get("x-razorpay-signature", ""), secret):
        raise Problem(400, "bad_signature", "Razorpay signature did not match.")
    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise Problem(400, "invalid_body", "Razorpay body was not JSON.") from exc
    try:
        result = await apply_webhook(app.state.licences, app.state.auth, "razorpay", event)
    except LicenceError as exc:
        raise _licence_problem(exc) from exc
    except ValueError as exc:
        raise Problem(400, "invalid_email", "The payment has no email address.") from exc
    return _deliver_key(result)


