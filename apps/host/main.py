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

from auth import mint_token, mint_user_token, require_user
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
    counts,
    create_conversation,
    get_messages,
    init_db,
    list_conversations,
    prune,
    write_trace,
)
from platform_store import (
    add_feedback,
    get_user_by_id,
    init_platform_db,
    list_feedback,
    counts as platform_counts,
    db_path as platform_db_path,
)
import accounts
import audit
import mail_queue
import vault


_SYSTEM_PROMPT: str | None = None

_FILE_GROUND = (
    "Attached files follow. Infer what they actually are from the filename and text. "
    "Answer the user's question from this text only. Quote real names, dates, numbers, and filenames. "
    "Read typos generously (e.g. 'specilised' means specialized/skills). "
    "For spreadsheets, use sheet names and tab-separated rows. "
    "When several files are attached, say which file each fact comes from. "
    "Do not invent folders, tests, READMEs, jobs, meetings, people, or a next-step unless they appear below. "
    "If the text is only a filename or a could-not-read note, say you could not read the file. Do not invent a story. "
    "If a line says you cannot see pixels, do not describe the image. "
    "Never answer by describing your role, instructions, or the chat UI.\n\n"
)

_OVERVIEW_OVERRIDE = (
    "OVERRIDE: The user wants a SUMMARY of the ATTACHED FILE contents only. "
    "Name each file and summarize what is inside using quotes, headings, paths, and numbers from the text below. "
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
    init_db()
    prune()
    vault.lock()
    moss.reload()


@asynccontextmanager
async def lifespan(_: FastAPI):
    instances.migrate_repo_data()
    init_platform_db()
    bind_instance()
    await mail_queue.start()
    yield
    await mail_queue.stop()


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
    result = accounts.register(req.email, req.password)
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
async def add_memory(note: NoteReq, _: dict = Depends(require_user)):
    doc_id = note.id or str(uuid.uuid4())
    moss.add(doc_id, note.text)
    return {"id": doc_id, "docs": moss.docs}


@app.get("/v1/memory/search")
async def search_memory(q: str, _: dict = Depends(require_user)):
    return await moss.query(q)


@app.get("/v1/conversations")
def conversations(_: dict = Depends(require_user)):
    return {"conversations": list_conversations()}


@app.post("/v1/conversations")
def new_conversation(_: dict = Depends(require_user)):
    return create_conversation()


@app.get("/v1/conversations/{conversation_id}/messages")
def messages(conversation_id: str, _: dict = Depends(require_user)):
    return {"messages": get_messages(conversation_id)}


@app.post("/v1/chat")
async def chat(req: ChatRequest, request: Request, session: dict = Depends(require_user)):
    rate_limit(request, f"chat:{session['sub']}")
    if instances.current() is None:
        raise instances.NoInstanceError()
    if vault.needs_unlock():
        raise HTTPException(status_code=423, detail="Unlock the vault with your master password.")
    if not await local_engine_alive():
        raise HTTPException(
            status_code=503,
            detail="No local model server. Start Ollama (`ollama serve`), LM Studio (port 1234), or llama.cpp `llama-server` (port 8080).",
        )

    cleaned, flags = sanitize_user_text(req.content)
    audit.append("chat.start", {"offline": req.offline, "voice": req.voice_input, "flags": flags})
    question = cleaned
    file_ctx = ""
    if "User question:" in cleaned:
        file_ctx, question = cleaned.rsplit("User question:", 1)
        question = question.strip() or cleaned
        file_ctx = file_ctx.strip()
    retrieval: dict = {"docs": [], "backend": "skipped", "time_taken_ms": 0}
    if file_ctx:
        # Attached files are the corpus. Do not mix in product seed docs or old chat turns.
        pass
    else:
        retrieval = await moss.query(question, local_only=req.offline)

    engine = await detect_engine()
    installed = list(engine.get("models") or [])
    model = req.model or pick_local_model(installed)
    conversation_id = req.conversation_id or create_conversation()["id"]
    user_msg = add_message(conversation_id, "user", question)
    history = get_messages(conversation_id)
    if file_ctx:
        history = history[-8:]
    clipped: list[dict] = []
    for m in history:
        clipped.append({"role": m["role"], "content": str(m["content"])[:1500]})
    history = clipped

    sources: list[dict] = []
    for line in file_ctx.splitlines():
        if line.startswith("### "):
            sources.append({"title": line[4:].strip()[:120], "kind": "file"})
    if not file_ctx:
        for d in retrieval.get("docs") or []:
            if str(d.get("id", "")).startswith("seed-"):
                continue
            sources.append(
                {
                    "title": str(d.get("id") or "note")[:80],
                    "kind": "moss",
                    "snippet": str(d.get("text") or "")[:160],
                }
            )
    sources = sources[:8]

    ground = ""
    canned = ""
    if file_ctx:
        interview = bool(
            re.search(
                r"\binterview questions?\b|\bquestions?\b.*\binterview\b|\binterview\b.*\bquestions?\b",
                question,
                re.I,
            )
        )
        already = file_ctx.lstrip().startswith(("OVERRIDE:", "Attached files follow."))
        if _file_ctx_too_thin(file_ctx):
            canned = _THIN_REPLY
        elif already:
            ground = file_ctx[:18000]
        elif interview:
            ground = (
                "OVERRIDE: The user asked for INTERVIEW QUESTIONS about these files. "
                "Write only numbered interview Q&A grounded in whatever these files actually are. "
                "Do not force a project or folder template.\n\n"
                + file_ctx[:18000]
            )
        elif re.search(
            r"\b(summar(y|ise|ize)?|overview|brief|include[sd]?|consist|what(?:'s| is| does)\s+(this|it)|what is this)\b",
            question,
            re.I,
        ):
            ground = _OVERVIEW_OVERRIDE + file_ctx[:18000]
        else:
            ground = _FILE_GROUND + file_ctx[:18000]
    elif retrieval.get("docs"):
        lines = []
        for d in retrieval["docs"][:6]:
            if str(d.get("id", "")).startswith("seed-"):
                continue
            lines.append(f"- [{d.get('id', 'note')}] {d.get('text', '')[:800]}")
        if lines:
            ground = (
                "On-device Moss hits "
                f"({retrieval.get('time_taken_ms')} ms, {retrieval.get('backend')}):\n" + "\n".join(lines)
            )

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
