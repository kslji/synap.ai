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
    user_id: str = Depends(get_user_id),
    gateway: GatewayService = Depends(get_gateway_service),
) -> Any:
    """Chat endpoint: send a message and get a response.
    
    Flow:
    1. Authenticate user via JWT
    2. Prepare messages with user's history
    3. Pre-flight check (token count, cost, max_tokens)
    4. Call OpenRouter
    5. Post-flight billing
    6. Save chat messages
    7. Return response
    
    Returns 402 if insufficient balance.
    Returns 400 if unknown model.
    """
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
    """List available models with pricing.
    
    Returns all models from the pricing table.
    """
    # This would need a method in the store to list all models
    # For now, return a placeholder
    return {"models": [], "message": "Use /api/v1/models from OpenRouter directly for now"}


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
