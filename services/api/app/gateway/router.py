"""API router for OpenRouter gateway endpoints."""
from __future__ import annotations

import logging
import os
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..tokens import read_bearer
from ..rate_limit import CHAT_IP_RATE_PER_MINUTE, CHAT_RATE_PER_MINUTE, client_ip
from .credits import credits_to_usd, usd_to_credits
from .model_allowlist import ALLOWED_MODELS
from .service import GatewayService

log = logging.getLogger("surf.gateway.router")

router = APIRouter(prefix="/api/v1", tags=["gateway"])


class ChatRequest(BaseModel):
    """Chat request payload."""
    model: str = Field(..., description="Model ID (e.g., 'anthropic/claude-3.5-sonnet')")
    prompt: str = Field(..., min_length=1, max_length=100000, description="User's message")
    stream: bool = Field(default=False, description="Whether to stream the response")


class ChatResponse(BaseModel):
    """Chat response payload."""
    id: str | None = None
    model: str
    choices: list[dict[str, Any]]
    usage: dict[str, int] | None = None
    billing: dict[str, Any] | None = None


class AgentRequest(BaseModel):
    """One stateless agent turn proposed by the device's agent loop.

    The device owns the loop and the history; this endpoint only forwards the turn
    to the provider and streams the raw result back, so the same loop can drive an
    online model without a second implementation.
    """
    model: str = Field(..., description="Model ID (e.g., 'anthropic/claude-3.5-sonnet')")
    messages: list[dict[str, Any]] = Field(..., min_length=1, max_length=400, description="The turn's messages, in order")
    tools: list[dict[str, Any]] | None = Field(default=None, description="Native tool schemas (OpenAI format)")
    response_format: dict[str, Any] | None = Field(default=None, description="json_schema constraint for a tool-call turn")
    grammar: str | None = Field(default=None, description="Grammar passthrough for the loop's last fallback rung")
    max_tokens: int | None = Field(default=None, ge=1, le=200000, description="Requested output cap; clamped to the balance")
    thinking: bool | None = Field(default=None, description="Accepted and ignored: the upstream models decide")
    stream: bool = Field(default=True, description="Whether to stream the response")

    @field_validator("messages")
    @classmethod
    def _every_message_has_a_role(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        allowed = {"system", "user", "assistant", "tool"}
        for message in value:
            if not isinstance(message.get("role"), str) or message["role"] not in allowed:
                raise ValueError("each message needs a role of system, user, assistant or tool")
        return value


async def get_gateway_service(request: Request) -> GatewayService:
    """Get gateway service from app state."""
    if not hasattr(request.app.state, "gateway"):
        raise HTTPException(status_code=503, detail="Gateway service not initialized")
    return request.app.state.gateway


async def get_user_id(authorization: str = Header(default="")) -> str:
    """Extract user ID from JWT token.
    
    The JWT token's 'uid' claim is the user ID.
    """
    try:
        claims = read_bearer(authorization)
        user_id = claims.get("uid")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: no user ID")
        return user_id
    except Exception as exc:
        log.warning("auth failed: %s", exc)
        raise HTTPException(status_code=401, detail="Invalid or missing authentication")


async def enforce_entry_rate_limits(request: Request, user_id: str) -> None:
    """Per-user + per-IP entry rate limit (the removed legacy host limiter's job).

    Shared by /chat and /agent/completions so one user cannot dodge the limiter
    by switching endpoint.
    """
    limiter = request.app.state.limiter
    allowed, retry = await limiter.hit(f"chat:user:{user_id}", CHAT_RATE_PER_MINUTE)
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.",
                            headers={"Retry-After": str(retry)})
    allowed, retry = await limiter.hit(f"chat:ip:{client_ip(request)}", CHAT_IP_RATE_PER_MINUTE)
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.",
                            headers={"Retry-After": str(retry)})


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    gateway: GatewayService = Depends(get_gateway_service),
) -> Any:
    """Chat endpoint: send a message and get a response.
    
    Flow:
    1. Rate limit (per user + per IP, Valkey-backed)
    2. Authenticate user via JWT
    3. Build this turn's messages (history stays on the device)
    4. Pre-flight check (token count, cost, max_tokens)
    5. Call OpenRouter
    6. Post-flight billing
    7. Return response
    
    Returns 402 if insufficient balance.
    Returns 400 if unknown model.
    """
    # 1. Per-user + per-IP entry rate limit (replaces the removed legacy host limiter).
    await enforce_entry_rate_limits(request, user_id)

    log.info("chat request from user=%s model=%s stream=%s", user_id, req.model, req.stream)
    
    result = await gateway.handle_chat_request(
        user_id=user_id,
        model=req.model,
        prompt=req.prompt,
        stream=req.stream,
    )
    
    if req.stream:
        # Return streaming response
        return StreamingResponse(result, media_type="text/event-stream")
    else:
        # Return JSON response
        return result


@router.post("/agent/completions")
async def agent_completions(
    req: AgentRequest,
    request: Request,
    user_id: str = Depends(get_user_id),
    gateway: GatewayService = Depends(get_gateway_service),
) -> Any:
    """Agent turn endpoint: forward one device-built turn (messages + tools) upstream.

    Stateless by design: the agent loop and the conversation live on the device, so
    the gateway never stores or replays these messages. It applies the same guards
    as /chat - rate limit, JWT, allowlist, balance pre-flight, billing - and streams
    the provider's chunks back untouched, content and tool-call deltas alike, so the
    device assembles them exactly like it does for a local model.

    Returns 402 if insufficient balance.
    Returns 400 if the model is not permitted or unknown.
    """
    await enforce_entry_rate_limits(request, user_id)

    log.info(
        "agent completion from user=%s model=%s messages=%d tools=%d stream=%s",
        user_id, req.model, len(req.messages), len(req.tools or []), req.stream,
    )

    result = await gateway.handle_agent_completion(
        user_id=user_id,
        model=req.model,
        messages=req.messages,
        stream=req.stream,
        tools=req.tools,
        response_format=req.response_format,
        grammar=req.grammar,
        max_tokens=req.max_tokens,
    )

    if req.stream:
        return StreamingResponse(result, media_type="text/event-stream")
    return result


@router.get("/models")
async def list_models(
    user_id: str = Depends(get_user_id),
    gateway: GatewayService = Depends(get_gateway_service),
) -> dict[str, Any]:
    """List the curated models with live pricing *and* this account's tier status.

    Only allowlisted models that have pricing synced are returned, so the picker never
    offers a model we cannot bill for. Each row carries `min_credits`, `locked` and
    `unlock_usd` so a picker can show a locked higher-tier model with an "Unlock with
    $N top-up" affordance rather than failing a locked call mid-chat (ADR 0008).
    """
    ids = [m.model_id for m in ALLOWED_MODELS]
    pricing = await gateway.store.list_model_pricing(ids)
    tiers = await gateway.store.list_model_tiers(ids)
    current = await gateway.store.get_max_topup_credits(user_id)
    models: list[dict[str, Any]] = []
    for m in ALLOWED_MODELS:
        p = pricing.get(m.model_id)
        if not p:
            continue
        tier = tiers.get(m.model_id)
        required = int(tier["min_credits"]) if tier else m.min_credits
        tier_label = tier["tier_label"] if tier else m.tier_label
        models.append({
            "id": m.model_id,
            "label": m.label,
            "provider": m.provider,
            "context_window": p["context_window"],
            "input_price_per_million": float(p["input_price_per_million"]),
            "output_price_per_million": float(p["output_price_per_million"]),
            "min_credits": required,
            "tier_label": tier_label,
            "locked": current < required,
            "unlock_usd": float(credits_to_usd(required)),
        })
    return {"models": models, "max_topup_credits": current}


@router.get("/balance")
async def get_balance(
    user_id: str = Depends(get_user_id),
    gateway: GatewayService = Depends(get_gateway_service),
) -> dict[str, Any]:
    """Get user's balance in USD and whole credits, purchase tier, and lock status."""
    balance_info = await gateway.store.get_user_balance(user_id)
    if not balance_info:
        # Create account if it doesn't exist
        await gateway.store.ensure_gateway_account(user_id, gateway.starting_credit)
        balance_info = await gateway.store.get_user_balance(user_id)
        if not balance_info:
            raise HTTPException(status_code=500, detail="Failed to create gateway account")

    balance, billing_locked = balance_info
    max_topup = await gateway.store.get_max_topup_credits(user_id)

    return {
        "user_id": user_id,
        "balance": float(balance),
        "credits": usd_to_credits(balance),
        "max_topup_credits": max_topup,
        "billing_locked": billing_locked,
        "currency": "USD",
    }
