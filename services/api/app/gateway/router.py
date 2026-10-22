"""API router for OpenRouter gateway endpoints."""
from __future__ import annotations

import logging
import os
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..tokens import read_bearer
from ..rate_limit import CHAT_IP_RATE_PER_MINUTE, CHAT_RATE_PER_MINUTE, client_ip
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
    limiter = request.app.state.limiter
    allowed, retry = await limiter.hit(f"chat:user:{user_id}", CHAT_RATE_PER_MINUTE)
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.",
                            headers={"Retry-After": str(retry)})
    allowed, retry = await limiter.hit(f"chat:ip:{client_ip(request)}", CHAT_IP_RATE_PER_MINUTE)
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.",
                            headers={"Retry-After": str(retry)})

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


@router.get("/models")
async def list_models(
    user_id: str = Depends(get_user_id),
    gateway: GatewayService = Depends(get_gateway_service),
) -> dict[str, Any]:
    """List the curated models available in Surf IDE, with live synced pricing.

    Only allowlisted models that have pricing synced from OpenRouter are
    returned, so the picker never offers a model we cannot bill for.
    """
    ids = [m.model_id for m in ALLOWED_MODELS]
    pricing = await gateway.store.list_model_pricing(ids)
    models: list[dict[str, Any]] = []
    for m in ALLOWED_MODELS:
        p = pricing.get(m.model_id)
        if not p:
            continue
        models.append({
            "id": m.model_id,
            "label": m.label,
            "provider": m.provider,
            "context_window": p["context_window"],
            "input_price_per_million": float(p["input_price_per_million"]),
            "output_price_per_million": float(p["output_price_per_million"]),
        })
    return {"models": models}


@router.get("/balance")
async def get_balance(
    user_id: str = Depends(get_user_id),
    gateway: GatewayService = Depends(get_gateway_service),
) -> dict[str, Any]:
    """Get user's current balance and account status."""
    balance_info = await gateway.store.get_user_balance(user_id)
    if not balance_info:
        # Create account if it doesn't exist
        await gateway.store.ensure_gateway_account(user_id, gateway.starting_credit)
        balance_info = await gateway.store.get_user_balance(user_id)
        if not balance_info:
            raise HTTPException(status_code=500, detail="Failed to create gateway account")
    
    balance, billing_locked = balance_info
    
    return {
        "user_id": user_id,
        "balance": float(balance),
        "billing_locked": billing_locked,
        "currency": "USD",
    }
