"""POST /api/v1/chat: context → pre-flight → OpenRouter → billing. No prompt or answer text is logged."""
from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from decimal import Decimal

from . import billing
from .context import compile_messages, history_token_budget, system_prompt
from .openrouter import OpenRouterClient
from .tokens import count_messages, count_text

log = logging.getLogger("surf.gateway")


class GatewayProblem(Exception):
    def __init__(self, status: int, code: str, detail: str):
        super().__init__(detail)
        self.status, self.code, self.detail = status, code, detail


@dataclass
class Prepared:
    user_id: str
    prompt: str
    pricing: billing.Pricing
    payload: dict
    flight: billing.PreFlight


def markup() -> Decimal:
    return Decimal(os.environ.get("GATEWAY_MARKUP", str(billing.DEFAULT_MARKUP)))


async def prepare(store, user_id: str, model: str, prompt: str, stream: bool) -> Prepared:
    account = await store.account(user_id)
    if account.billing_locked:
        raise GatewayProblem(402, "billing_locked", "Balance is used up. Recharge to keep chatting.")
    pricing = await store.get_pricing(model)
    if pricing is None:
        raise GatewayProblem(400, "unknown_model", "That model is not in the price table.")
    history = await store.history(user_id)
    messages = compile_messages(history, prompt, system_prompt(), history_token_budget(), count_text)
    flight = billing.preflight(account.balance, count_messages(messages), pricing)
    if not flight.allowed:
        raise GatewayProblem(402, "insufficient_balance", "Balance does not cover this request.")
    payload = {"model": model, "messages": messages, "max_tokens": flight.max_tokens, "stream": stream, "usage": {"include": True}}
    return Prepared(user_id, prompt, pricing, payload, flight)


async def settle(store, prep: Prepared, usage: dict | None, reply: str, generation_id: str | None, completion_estimate: int = 0) -> dict:
    """Bill on OpenRouter's native usage. Without usage, fall back to the buffered local counts."""
    if usage and "prompt_tokens" in usage:
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
    else:
        prompt_tokens = int(prep.flight.buffered_tokens) + 1
        completion_tokens = completion_estimate
    raw = billing.raw_cost(prompt_tokens, completion_tokens, prep.pricing.input_price_per_million, prep.pricing.output_price_per_million)
    rate = markup()
    deduction = billing.final_deduction(raw, rate)
    record = {
        "model_id": prep.pricing.model_id,
        "generation_id": generation_id,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "input_price_per_million": prep.pricing.input_price_per_million,
        "output_price_per_million": prep.pricing.output_price_per_million,
        "raw_cost": raw,
        "markup": rate,
    }
    charge = await store.charge(prep.user_id, deduction, record, prep.prompt, reply)
    log.info("chat billed user_id=%s prompt_tokens=%d completion_tokens=%d", prep.user_id, prompt_tokens, completion_tokens)
    return {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "raw_cost": str(raw),
        "deduction": str(deduction),
        "balance": str(charge.balance_after),
        "billing_locked": charge.billing_locked,
    }


async def complete(store, client: OpenRouterClient, prep: Prepared) -> dict:
    body = await client.complete(prep.payload)
    choice = (body.get("choices") or [{}])[0]
    reply = str((choice.get("message") or {}).get("content") or "")
    bill = await settle(store, prep, body.get("usage"), reply, body.get("id"), count_text(reply))
    return {"id": body.get("id"), "model": prep.pricing.model_id, "message": {"role": "assistant", "content": reply},
            "max_tokens": prep.flight.max_tokens, "billing": bill}


async def stream(store, client: OpenRouterClient, prep: Prepared) -> AsyncIterator[bytes]:
    """Relay SSE and cut the stream once the local completion count reaches the affordable max_tokens."""
    parts: list[str] = []
    usage: dict | None = None
    generation_id: str | None = None
    produced = 0
    severed = False
    async for event in client.stream(prep.payload):
        generation_id = event.get("id") or generation_id
        if event.get("usage"):
            usage = event["usage"]
        delta = ((event.get("choices") or [{}])[0].get("delta") or {}).get("content") or ""
        if delta:
            produced += count_text(delta)
            parts.append(delta)
            yield f"data: {json.dumps({'delta': delta})}\n\n".encode()
        if produced >= prep.flight.max_tokens:
            severed = True
            break
    bill = await settle(store, prep, None if severed else usage, "".join(parts), generation_id, produced)
    if severed:
        yield f"data: {json.dumps({'error': {'code': 'budget_exhausted', 'message': 'Stopped: balance reached its limit.'}})}\n\n".encode()
    yield f"data: {json.dumps({'billing': bill})}\n\n".encode()
    yield b"data: [DONE]\n\n"
