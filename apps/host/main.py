from __future__ import annotations

import json
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from auth import mint_admin_token, mint_token, mint_user_token, require_admin, require_session, require_user
from config import settings
from guardrails import sanitize_user_text
import instances
from livekit_probe import livekit_reachable
from livekit_tokens import livekit_configured, mint_livekit_token
from moss_runtime import runtime as moss
from ollama_client import (
    cpu_threads,
    detect_engine,
    list_models,
    local_engine_alive,
    ollama_alive,
    pick_local_model,
    pull_model,
    ram_for,
    stream_chat,
    total_ram_gb,
)
from rate_limit import rate_limit
from store import (
    add_message,
    clear_chat_data,
    counts,
    create_conversation,
    export_user_summaries,
    get_messages,
    init_db,
    list_conversations,
    list_user_summaries,
    prune,
    purge_stale_user_summaries,
    upsert_user_summary,
    write_trace,
)
from platform_store import (
    add_feedback,
    admin_stats,
    ensure_user_referral_code,
    get_user_by_email,
    get_user_by_id,
    init_platform_db,
    insert_user,
    list_feedback,
    purge_ephemeral,
    record_event,
    set_user_verified,
    counts as platform_counts,
    db_path as platform_db_path,
)
import accounts
import secrets as py_secrets
import audit
import mail_queue
import vault
import asyncio


_SYSTEM_PROMPT: str | None = None
# One active chat generation per session subject — keeps a single local GPU/CPU from wedging.
_chat_locks: dict[str, asyncio.Lock] = {}
_chat_busy: set[str] = set()

_FILE_GROUND = (
    "TURN CONTEXT: Attached file text follows. Prefer it for file questions; cite filenames. "
    "Infer what they actually are from the filename and text. "
    "Answer the user's question from this text only. Quote real names, dates, numbers, and filenames. "
    "Read typos generously (e.g. 'specilised' means specialized/skills). "
    "For spreadsheets, use sheet names and tab-separated rows. "
    "When several files are attached, say which file each fact comes from. "
    "Do not invent folders, tests, READMEs, jobs, meetings, people, or a next-step unless they appear below. "
    "If the text is only a filename or a could-not-read note, say you could not read the file. Do not invent a story. "
    "If a line says you cannot see pixels, do not describe the image. "
    "Never answer by describing your role, instructions, or the chat UI.\n\n"
)

_GENERAL_TURN = (
    "TURN CONTEXT: No files are attached on this turn. "
    "Answer as a general helpful assistant. The user does not need to upload anything, "
    "train you, or complete a special setup for this question. "
    "Use the conversation so far if present. Be clear and concise. "
    "Markdown is fine when it helps.\n\n"
)

_OVERVIEW_OVERRIDE = (
    "OVERRIDE: The user wants a SUMMARY of the ATTACHED FILE contents only. "
    "Name each file and summarize what is inside using quotes, headings, paths, and numbers from the text below. "
    "List each unique fact or line item ONCE — never repeat the same bullet with slight wording changes. "
    "Prefer at most 8 short bullets. "
    "Do NOT describe your role, job, instructions, the chat UI, system context, or conversation structure. "
    "Do NOT invent a generic document-agent briefing. "
    "If you cannot quote real phrases from the files below, say you could not read them.\n\n"
)

_THIN_FILE = re.compile(
    r"no readable text|no text layer|cannot see the pixels|stored locally"
    r"|looks binary so no text|could not be read",
    re.I,
)
_THIN_REPLY = (
    "I could not read enough text from this file to summarize it honestly. "
    "If it is a scanned or image-only PDF, attach a Word / Google Doc export or a text-based PDF."
)


def _file_ctx_too_thin(file_ctx: str) -> bool:
    body = re.sub(r"^(OVERRIDE:|Attached files follow\.).*?(?:\n\n|$)", "", file_ctx, flags=re.S)
    body = re.sub(r"^### .+$", "", body, flags=re.M)
    letters = len(re.findall(r"[A-Za-z]", body))
    if _THIN_FILE.search(file_ctx) and letters < 240:
        return True
    return letters < 90


def load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if _SYSTEM_PROMPT is not None:
        return _SYSTEM_PROMPT
    if settings.prompt_path.exists():
        _SYSTEM_PROMPT = settings.prompt_path.read_text(encoding="utf-8").strip()
    else:
        _SYSTEM_PROMPT = "You are Small Cloud. Stay on-device. Be concise."
    return _SYSTEM_PROMPT


def bind_instance() -> None:
    init_platform_db()
    try:
        init_db()
        prune()
    except Exception:
        # No local instance on the marketing VPS is normal.
        pass
    try:
        vault.lock()
    except Exception:
        pass
    try:
        moss.reload()
    except Exception:
        pass


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Boot must never kill the marketing VPS — auth/OTP must stay up."""
    try:
        instances.migrate_repo_data()
    except Exception:
        pass
    try:
        init_platform_db()
    except Exception as exc:
        # Last resort: log and continue so gunicorn does not crash-loop.
        print(f"platform db init warning: {exc}", flush=True)
    try:
        bind_instance()
    except Exception:
        pass
    try:
        purge_ephemeral(24)
    except Exception:
        pass
    try:
        purge_stale_user_summaries(24)
    except Exception:
        pass
    try:
        await mail_queue.start()
    except Exception:
        pass
    yield
    try:
        await mail_queue.stop()
    except Exception:
        pass


app = FastAPI(title="local.ai Host", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(instances.NoInstanceError)
async def no_instance_handler(_: Request, exc: instances.NoInstanceError):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


class SessionReq(BaseModel):
    client_id: str = Field(min_length=8, max_length=80)


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    content: str = Field(min_length=1, max_length=48000)
    model: str | None = None
    voice_input: bool = False
    offline: bool = False


class NoteReq(BaseModel):
    id: str | None = None
    text: str = Field(min_length=1, max_length=16000)


class PasswordReq(BaseModel):
    password: str = Field(min_length=8, max_length=200)


class MossSetupReq(BaseModel):
    project_id: str = Field(min_length=4, max_length=120)
    project_key: str = Field(min_length=8, max_length=200)


class InstanceReq(BaseModel):
    name: str = Field(min_length=2, max_length=60)


class FeedbackReq(BaseModel):
    rating: Literal["up", "down"]
    title: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    engine: str | None = Field(default=None, max_length=32)


class EmailAuthReq(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=200)
    referral_code: str | None = Field(default=None, max_length=32)


class TrackEventReq(BaseModel):
    kind: Literal["model_click", "agent_click", "download"]
    label: str = Field(min_length=1, max_length=120)
    referral_code: str | None = Field(default=None, max_length=32)


class OtpReq(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    otp: str = Field(min_length=4, max_length=12)


class ResetReq(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    otp: str = Field(min_length=4, max_length=12)
    password: str = Field(min_length=8, max_length=200)


class EmailOnlyReq(BaseModel):
    email: str = Field(min_length=3, max_length=254)


class ResendReq(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    purpose: Literal["verify", "reset"] = "verify"


@app.get("/health")
async def health():
    alive = await ollama_alive()
    engine = await detect_engine()
    models = list(engine.get("models") or [])
    default = settings.default_model
    chosen = pick_local_model(models) if models else default
    model_installed = any(
        m == default or m.startswith(f"{default}:") or m.split(":")[0] == default.split(":")[0]
        for m in models
    )
    lk_up = livekit_reachable()
    vault_status = vault.status()
    return {
        "ok": True,
        "host": "small-cloud",
        "ollama": alive,
        "default_model": default,
        "active_model": chosen,
        "model_installed": model_installed,
        "keep_alive": settings.keep_alive,
        "num_ctx": settings.num_ctx,
        "num_thread": cpu_threads(),
        "ram": ram_for(chosen),
        "runtime": {
            "ram_gb": total_ram_gb(),
            "threads": cpu_threads(),
            "keep_alive": settings.keep_alive,
            "mmap": True,
            "prefix_cache": "stable-system-prompt",
            "active_model": chosen,
            "backend": engine.get("backend"),
            "note": "Uses a local server that is already running. Never OpenAI/Anthropic.",
        },
        "local_llm": engine,
        "privacy": {"chat": "local-instance", "voice": "browser-vendor+livekit-loopback", "platform_bytes": 0},
        "platform": instances.snapshot(),
        "storage": {**instances.storage_report(), "sqlite": counts()},
        "livekit": {
            "configured": livekit_configured(),
            "reachable": lk_up,
            "url": settings.livekit_url,
        },
        "moss": {"enabled": moss.enabled, "backend": moss.backend, "docs": moss.docs, "sdk": moss.backend == "moss"},
        "vault": vault_status,
        "onboarding": {
            "host": True,
            "ollama": alive,
            "model": bool(models),
            "local_llm": engine.get("backend"),
            "livekit": lk_up,
            "moss_sdk": moss.backend == "moss",
            "vault_unlocked": vault_status["unlocked"],
        },
        "connectivity": "local-instance",
        "models": models,
        "deferred": [
            "eBPF/WFP kernel firewall",
            "Whisper weights in-process",
            "SDXL",
            "Playwright sandbox",
            "Syncthing P2P",
            "Pyodide orchestrator",
        ],
    }


@app.get("/v1/health")
async def v1_health():
    return await health()


@app.post("/v1/auth/session")
async def session(req: SessionReq, request: Request):
    if instances.current() is None:
        raise instances.NoInstanceError()
    rate_limit(request, f"auth:{req.client_id}")
    return {"token": mint_token(req.client_id), "token_type": "bearer", "aud": "local-ai"}


def _token_payload(user: dict) -> dict:
    return {
        "token": mint_user_token(user),
        "token_type": "bearer",
        "aud": "local-ai",
        "user": user,
    }


@app.post("/v1/auth/register")
def auth_register(req: EmailAuthReq, request: Request):
    rate_limit(request, f"register:{req.email.lower()}")
    result = accounts.register(req.email, req.password, referral_code=req.referral_code)
    audit.append("auth.register", {"email": result["email"]})
    return result


@app.post("/v1/auth/verify-email")
def auth_verify(req: OtpReq, request: Request):
    rate_limit(request, f"verify:{req.email.lower()}")
    user = accounts.verify_email(req.email, req.otp)
    audit.append("auth.verify", {"email": user["email"]})
    return _token_payload(user)


@app.post("/v1/auth/login")
def auth_login(req: EmailAuthReq, request: Request):
    rate_limit(request, f"login:{req.email.lower()}")
    user = accounts.login(req.email, req.password)
    audit.append("auth.login", {"email": user["email"]})
    return _token_payload(user)


@app.post("/v1/track")
def track_event(req: TrackEventReq, request: Request):
    """Public, rate-limited analytics (model / agent / download clicks)."""
    rate_limit(request, f"track:{request.client.host if request.client else 'anon'}")
    record_event(req.kind, req.label.strip(), referral_code=req.referral_code)
    return {"ok": True}


@app.post("/v1/admin/login")
def admin_login(req: EmailAuthReq, request: Request):
    rate_limit(request, f"admin-login:{req.email.lower()}")
    email = accounts.normalize_email(req.email)
    if not settings.admin_password or email not in settings.admin_email_set:
        raise HTTPException(status_code=401, detail="Admin sign-in is not available.")
    given = req.password.encode("utf-8")
    expected = settings.admin_password.encode("utf-8")
    if len(given) != len(expected) or not py_secrets.compare_digest(given, expected):
        raise HTTPException(status_code=401, detail="Email or password is wrong.")
    # Stable referral code per admin email (stored on a shadow user row if needed).
    row = get_user_by_email(email)
    if not row:
        row = insert_user(email, accounts.hash_secret(py_secrets.token_urlsafe(24)))
        set_user_verified(row["id"])
        row = get_user_by_id(row["id"])
    assert row
    code = ensure_user_referral_code(row["id"])
    record_event("admin_login", email)
    return {
        "token": mint_admin_token(email),
        "token_type": "bearer",
        "email": email,
        "referral_code": code,
        "referral_path": f"/download?ref={code}",
    }


@app.get("/v1/admin/stats")
def admin_stats_route(_: dict = Depends(require_admin)):
    return admin_stats()


@app.get("/v1/admin/me")
def admin_me(session: dict = Depends(require_admin)):
    email = str(session["email"]).lower()
    row = get_user_by_email(email)
    code = ensure_user_referral_code(row["id"]) if row else ""
    return {
        "email": email,
        "referral_code": code,
        "referral_path": f"/download?ref={code}" if code else "",
    }


@app.post("/v1/auth/forgot")
def auth_forgot(req: EmailOnlyReq, request: Request):
    rate_limit(request, f"forgot:{req.email.lower()}")
    result = accounts.forgot(req.email)
    audit.append("auth.forgot")
    return result


@app.post("/v1/auth/reset")
def auth_reset(req: ResetReq, request: Request):
    rate_limit(request, f"reset:{req.email.lower()}")
    user = accounts.reset_password(req.email, req.otp, req.password)
    audit.append("auth.reset", {"email": user["email"]})
    return _token_payload(user)


@app.post("/v1/auth/resend-otp")
def auth_resend(req: ResendReq, request: Request):
    rate_limit(request, f"resend:{req.email.lower()}")
    return accounts.resend(req.email, req.purpose)


@app.get("/v1/auth/me")
def auth_me(session: dict = Depends(require_user)):
    user = get_user_by_id(session["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="Profile not found. Create an account.")
    return accounts.public_user(user)


@app.get("/v1/storage")
def storage():
    report = instances.storage_report()
    report["sqlite"] = counts()
    report["platform"] = {**platform_counts(), "db": str(platform_db_path())}
    report["actions"] = {
        "keep_summary": "Browser agent only: fold chats into a short memory note, then delete the chat text. The agent still receives that note.",
        "erase_data": "Browser agent only: delete chats and memory from this browser. The agent starts with no context.",
    }
    return report


@app.get("/v1/instances")
def list_instances():
    return instances.snapshot()


@app.post("/v1/instances")
def create_instance(req: InstanceReq, request: Request):
    rate_limit(request, "instance-create")
    try:
        created = instances.create(req.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    bind_instance()
    audit.append("instance.create", {"id": created["id"], "name": created["name"]})
    return created


@app.post("/v1/instances/{instance_id}/activate")
def activate_instance(instance_id: str, request: Request):
    rate_limit(request, "instance-activate")
    try:
        active = instances.activate(instance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    bind_instance()
    audit.append("instance.activate", {"id": instance_id})
    return active


@app.get("/v1/models")
async def models(_: dict = Depends(require_user)):
    names = await list_models()
    return {
        "default": settings.default_model,
        "models": [{"name": n, **ram_for(n)} for n in names]
        or [{"name": settings.default_model, **ram_for(settings.default_model)}],
    }


@app.post("/v1/livekit/token")
async def livekit_token(request: Request, session: dict = Depends(require_user)):
    rate_limit(request, f"lk:{session['sub']}")
    if not livekit_reachable():
        raise HTTPException(
            status_code=503,
            detail="LiveKit is not listening on 7880. Run `livekit-server --dev`.",
        )
    try:
        return mint_livekit_token(session["sub"])
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/v1/vault")
def vault_get(_: dict = Depends(require_user)):
    return vault.status()


@app.post("/v1/vault/setup")
def vault_setup(req: PasswordReq, _: dict = Depends(require_user)):
    try:
        st = vault.setup(req.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    audit.append("vault.setup")
    return st


@app.post("/v1/vault/unlock")
def vault_unlock(req: PasswordReq, _: dict = Depends(require_user)):
    try:
        st = vault.unlock(req.password)
    except PermissionError:
        raise HTTPException(status_code=401, detail="Wrong master password")
    audit.append("vault.unlock")
    return st


@app.post("/v1/vault/lock")
def vault_lock(_: dict = Depends(require_user)):
    audit.append("vault.lock")
    return vault.lock()


@app.post("/v1/setup/moss")
def setup_moss(req: MossSetupReq, _: dict = Depends(require_user)):
    result = moss.configure(req.project_id, req.project_key)
    audit.append("moss.credentials", {"sdk": result.get("sdk")})
    return result


@app.post("/v1/ollama/pull")
async def ollama_pull(_: dict = Depends(require_user)):
    if not await ollama_alive():
        raise HTTPException(status_code=503, detail="Start Ollama first (`ollama serve`).")
    audit.append("ollama.pull", {"model": settings.default_model})
    try:
        return await pull_model(settings.default_model)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/v1/audit")
def audit_log(_: dict = Depends(require_user)):
    return {"events": audit.tail()}


@app.post("/v1/feedback")
def create_feedback(req: FeedbackReq, request: Request, session: dict = Depends(require_user)):
    rate_limit(request, f"feedback:{session['sub']}")
    title, title_flags = sanitize_user_text(req.title)
    message, msg_flags = sanitize_user_text(req.message)
    flags = list(dict.fromkeys(title_flags + msg_flags))
    engine = (req.engine or "").strip().lower() or None
    if engine and engine not in {"ollama", "browser"}:
        engine = engine[:32]
    row = add_feedback(
        rating=req.rating,
        title=title[:120],
        message=message[:4000],
        conversation_id=req.conversation_id,
        client_id=str(session["sub"]),
        engine=engine,
        flags=flags,
    )
    audit.append(
        "feedback.create",
        {"id": row["id"], "rating": req.rating, "flags": flags, "engine": engine},
    )
    return row


@app.get("/v1/feedback")
def get_feedback(
    session: dict = Depends(require_user),
    limit: int = Query(default=80, ge=1, le=200),
):
    return {"items": list_feedback(limit), "client_id": session["sub"]}


@app.post("/v1/storage/prune")
def storage_prune(_: dict = Depends(require_user)):
    prune()
    audit.append("storage.prune")
    return {"ok": True}


@app.post("/v1/storage/erase")
def storage_erase(session: dict = Depends(require_session)):
    """Clear host chat history + this session's Moss slice when they delete browser data."""
    cleared = clear_chat_data()
    moss.clear(owner=str(session.get("sub") or "").strip())
    audit.append("storage.erase", cleared)
    return {"ok": True, **cleared, "moss_docs": moss.docs}


@app.post("/v1/convert/pdf")
async def convert_pdf_endpoint(_: dict = Depends(require_user)):
    raise HTTPException(
        status_code=501,
        detail=(
            "File conversion is not supported right now. "
            "Surf can read attached files for questions, but does not convert between formats."
        ),
    )


@app.post("/v1/memory")
async def add_memory(note: NoteReq, session: dict = Depends(require_session)):
    doc_id = note.id or str(uuid.uuid4())
    owner = str(session.get("sub") or "").strip()
    if not owner:
        raise HTTPException(status_code=401, detail="Missing session subject")
    moss.add(doc_id, note.text, owner=owner)
    return {"id": doc_id, "docs": moss.docs}


class SummaryReq(BaseModel):
    title: str = Field(default="Session summary", max_length=120)
    body: str = Field(min_length=1, max_length=8000)
    source: str = Field(default="chat", max_length=32)
    id: str | None = None


@app.post("/v1/summaries")
def save_summary(req: SummaryReq, session: dict = Depends(require_session)):
    """Rolling summary for this user — local instance SQLite only."""
    if instances.current() is None:
        raise instances.NoInstanceError()
    owner = str(session.get("sub") or "").strip()
    if not owner:
        raise HTTPException(status_code=401, detail="Missing session subject")
    try:
        row = upsert_user_summary(
            owner_id=owner,
            title=req.title,
            body=req.body,
            source=req.source,
            summary_id=req.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    export_user_summaries(owner)
    return row


@app.get("/v1/summaries")
def get_summaries(
    session: dict = Depends(require_session),
    limit: int = Query(default=40, ge=1, le=200),
):
    owner = str(session.get("sub") or "").strip()
    if not owner:
        raise HTTPException(status_code=401, detail="Missing session subject")
    if instances.current() is None:
        return {"items": [], "owner_id": owner}
    return {"items": list_user_summaries(owner, limit=limit), "owner_id": owner}


@app.post("/v1/summaries/export")
def export_summaries(session: dict = Depends(require_session)):
    """Write this user's summaries into summaries/<owner>/ for offline local use."""
    if instances.current() is None:
        raise instances.NoInstanceError()
    owner = str(session.get("sub") or "").strip()
    if not owner:
        raise HTTPException(status_code=401, detail="Missing session subject")
    return export_user_summaries(owner)


@app.post("/v1/platform/purge")
def platform_purge(_: dict = Depends(require_user)):
    """Operator/maintenance: purge VPS platform ephemera older than 24h (no chats stored)."""
    return purge_ephemeral(24)


@app.get("/v1/memory/search")
async def search_memory(
    q: str,
    session: dict = Depends(require_session),
    local_only: bool = Query(False, description="Skip Moss SDK; use on-device keyword fallback"),
):
    owner = str(session.get("sub") or "").strip()
    if not owner:
        raise HTTPException(status_code=401, detail="Missing session subject")
    # Online (local_only=false) → Moss SDK when .env keys exist; else keyword.
    # Offline (local_only=true) → keyword only — no network Moss calls.
    return await moss.query(q, local_only=local_only, owner=owner)


@app.get("/v1/conversations")
def conversations(_: dict = Depends(require_session)):
    return {"conversations": list_conversations()}


@app.post("/v1/conversations")
def new_conversation(_: dict = Depends(require_session)):
    return create_conversation()


@app.get("/v1/conversations/{conversation_id}/messages")
def messages(conversation_id: str, _: dict = Depends(require_session)):
    return {"messages": get_messages(conversation_id)}


@app.post("/v1/chat")
async def chat(req: ChatRequest, request: Request, session: dict = Depends(require_session)):
    rate_limit(request, f"chat:{session['sub']}")
    owner_key = str(session.get("sub") or "").strip() or "anon"
    lock = _chat_locks.setdefault(owner_key, asyncio.Lock())
    if lock.locked() or owner_key in _chat_busy:
        raise HTTPException(
            status_code=429,
            detail="Another answer is still generating on this computer. Wait for it to finish, then send again.",
        )
    async with lock:
        _chat_busy.add(owner_key)
        try:
            return await _run_chat(req, session)
        finally:
            _chat_busy.discard(owner_key)


async def _run_chat(req: ChatRequest, session: dict):
    if instances.current() is None:
        raise instances.NoInstanceError()
    if vault.needs_unlock():
        raise HTTPException(status_code=423, detail="Unlock the vault with your master password.")
    if not await local_engine_alive():
        raise HTTPException(
            status_code=503,
            detail="No local model server. Start Ollama (`ollama serve`), Colibri (`coli serve` on :8000), LM Studio (port 1234), or llama.cpp `llama-server` (port 8080).",
        )

    cleaned, flags = sanitize_user_text(req.content)
    audit.append("chat.start", {"offline": req.offline, "voice": req.voice_input, "flags": flags})
    question = cleaned
    file_ctx = ""
    if "User question:" in cleaned:
        file_ctx, question = cleaned.rsplit("User question:", 1)
        question = question.strip() or cleaned
        file_ctx = file_ctx.strip()
    owner = str(session.get("sub") or "").strip()
    retrieval: dict = {"docs": [], "backend": "skipped", "time_taken_ms": 0}
    if file_ctx:
        # Attached files are the corpus. Do not mix in host Moss docs (or other users').
        pass
    else:
        # Shared demo hosts keep one Moss file — always scope hits to this session subject.
        retrieval = await moss.query(question, local_only=req.offline, owner=owner)

    engine = await detect_engine()
    installed = list(engine.get("models") or [])
    model = req.model or pick_local_model(installed)
    conversation_id = req.conversation_id or create_conversation()["id"]
    user_msg = add_message(conversation_id, "user", question)
    history = get_messages(conversation_id)
    light = bool(re.search(r"1b|1\.5b|2b", (model or settings.default_model), re.I))
    if file_ctx:
        history = history[-4:] if light else history[-8:]
    clipped: list[dict] = []
    turn_cap = 600 if light else 1500
    for m in history:
        clipped.append({"role": m["role"], "content": str(m["content"])[:turn_cap]})
    history = clipped

    sources: list[dict] = []
    seen_titles: set[str] = set()
    for line in file_ctx.splitlines():
        if line.startswith("### "):
            title = line[4:].strip()[:120]
            key = title.lower()
            if not title or key in seen_titles:
                continue
            seen_titles.add(key)
            sources.append({"title": title, "kind": "file"})
    if not file_ctx:
        for d in retrieval.get("docs") or []:
            if str(d.get("id", "")).startswith("seed-"):
                continue
            title = str(d.get("id") or "note")[:80]
            # Prefer human filename when Moss ids look like file-Resume.pdf
            if title.startswith("file-"):
                title = title[5:]
            key = title.lower()
            if key in seen_titles:
                continue
            seen_titles.add(key)
            sources.append(
                {
                    "title": title,
                    "kind": "moss",
                    "snippet": str(d.get("text") or "")[:160],
                }
            )
    sources = sources[:8]

    ground = ""
    canned = ""
    file_cap = 2800 if light else 18000
    if file_ctx:
        interview = bool(
            re.search(
                r"\binterview(er|ing|s)?\b.*\bquestions?\b|\bquestions?\b.*\binterview(er|ing|s)?\b|"
                r"\bquestions?\b.*\b(resume|cv)\b|\b(resume|cv)\b.*\bquestions?\b|"
                r"\bquestions?\b.*\b(could|would|might|should)\b.*\bask\b",
                question,
                re.I,
            )
        )
        already = file_ctx.lstrip().startswith(("OVERRIDE:", "Attached files follow."))
        if _file_ctx_too_thin(file_ctx):
            canned = _THIN_REPLY
        elif already:
            ground = file_ctx[:file_cap]
        elif interview:
            ground = (
                "OVERRIDE: The user asked for INTERVIEW QUESTIONS about these files. "
                "Write only numbered interview Q&A grounded in whatever these files actually are. "
                "Number items 1, 2, 3 in order (never repeat 1). Do not put a blank line between each item. "
                "Do not force a project or folder template. Keep each answer to 1-2 short sentences.\n\n"
                + file_ctx[:file_cap]
            )
        elif re.search(
            r"\b(mermaid|flowchart|diagram|visuali[sz]e|architecture)\b",
            question,
            re.I,
        ):
            ground = (
                "OVERRIDE: The user asked for an ARCHITECTURE / FLOW DIAGRAM. "
                "Reply with a short intro and a fenced mermaid flowchart TB using real folder names from the files. "
                "Do not dump only a file tree list.\n\n"
                + file_ctx[:file_cap]
            )
        elif re.search(
            r"\b(summar(y|ise|ize)?|overview|brief|include[sd]?|consist|what(?:'s| is| does)\s+(this|it)|what is this)\b",
            question,
            re.I,
        ):
            ground = _OVERVIEW_OVERRIDE + file_ctx[:file_cap]
        else:
            ground = _FILE_GROUND + file_ctx[:file_cap]
    elif retrieval.get("docs"):
        lines = []
        for d in retrieval["docs"][:6]:
            if str(d.get("id", "")).startswith("seed-"):
                continue
            lines.append(f"- [{d.get('id', 'note')}] {d.get('text', '')[:800]}")
        if lines:
            ground = (
                _GENERAL_TURN
                + "Optional on-device Moss hits "
                f"({retrieval.get('time_taken_ms')} ms, {retrieval.get('backend')}) — use only if relevant:\n"
                + "\n".join(lines)
            )
        else:
            ground = _GENERAL_TURN
    else:
        # First-time / general questions: inject turn cue so the model does not wait for files.
        ground = _GENERAL_TURN

    # Per-user rolling summaries (local only) — never shared across accounts.
    if owner:
        bits = []
        for s in list_user_summaries(owner, limit=3):
            bits.append(f"### {s.get('title') or 'Summary'}\n{str(s.get('body') or '')[:1200]}")
        if bits:
            ground = (
                ground
                + "\n\nPrior session summaries for this user only (do not invent beyond these):\n"
                + "\n\n".join(bits)
            ).strip()

    # System prompt is identical every turn so Ollama can prefix-cache it.
    ollama_messages = [{"role": "system", "content": load_system_prompt()}]
    prior = history[:-1] if history else []
    ollama_messages += [{"role": m["role"], "content": m["content"]} for m in prior]
    last_user = history[-1]["content"] if history else question
    if ground:
        last_user = ground + "\n\nUser question:\n" + last_user
    ollama_messages.append({"role": "user", "content": last_user})

    trace_id = str(uuid.uuid4())
    t0 = time.perf_counter()

    async def generate():
        assistant = ""
        error = None
        meta = {
            "type": "meta",
            "trace_id": trace_id,
            "conversation_id": conversation_id,
            "model": model,
            "ram": ram_for(model),
            "keep_alive": settings.keep_alive,
            "num_thread": cpu_threads(),
            "llm_backend": engine.get("backend"),
            "llm_url": engine.get("url"),
            "voice_input": req.voice_input,
            "offline": req.offline,
            "guardrail_flags": flags,
            "sources": sources,
            "moss": {
                "backend": retrieval.get("backend"),
                "time_taken_ms": retrieval.get("time_taken_ms"),
                "hits": len(retrieval.get("docs") or []),
            },
            "user_message_id": user_msg["id"],
        }
        yield f"data: {json.dumps(meta)}\n\n"
        if canned:
            assistant = canned
            yield f"data: {json.dumps({'type': 'delta', 'content': canned})}\n\n"
        else:
            try:
                async for raw in stream_chat(model, ollama_messages, engine):
                    chunk = json.loads(raw)
                    piece = (chunk.get("message") or {}).get("content") or ""
                    if piece:
                        assistant += piece
                        yield f"data: {json.dumps({'type': 'delta', 'content': piece})}\n\n"
                    if chunk.get("done"):
                        break
            except httpx.HTTPError as exc:
                error = str(exc)
                yield f"data: {json.dumps({'type': 'error', 'detail': error})}\n\n"

        if assistant:
            saved = add_message(conversation_id, "assistant", assistant)
            msg_id = saved["id"]
            if owner and len(assistant) > 40:
                try:
                    snippet = (
                        f"User asked: {question[:400]}\n"
                        f"Assistant: {assistant[:1200]}"
                    )
                    upsert_user_summary(
                        owner_id=owner,
                        title=f"Chat {conversation_id[:8]}",
                        body=snippet,
                        source="live-chat",
                        summary_id=f"roll-{owner[:24]}-{conversation_id[:8]}",
                    )
                    if req.offline:
                        export_user_summaries(owner)
                except Exception:
                    pass
        else:
            msg_id = None

        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        write_trace(
            {
                "id": trace_id,
                "conversation_id": conversation_id,
                "model": model,
                "voice_input": req.voice_input,
                "offline": req.offline,
                "error": error,
                "guardrail_flags": flags,
                "moss": retrieval,
                "latency_ms": latency_ms,
                "prompt_chars": len(cleaned),
                "completion_chars": len(assistant),
                "keep_alive": settings.keep_alive,
                "otel": {
                    "trace_id": trace_id,
                    "span": "host.chat",
                    "attributes": {"llm.model": model, "moss.ms": retrieval.get("time_taken_ms")},
                },
            }
        )
        yield f"data: {json.dumps({'type': 'done', 'assistant_message_id': msg_id, 'latency_ms': latency_ms})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
