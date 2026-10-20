"""OpenRouter client and the price sync. The master key stays on the server (OPENROUTER_API_KEY)."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from collections.abc import AsyncIterator
from decimal import Decimal, InvalidOperation

import httpx

from .billing import MILLION, Pricing

log = logging.getLogger("surf.gateway")
DEFAULT_BASE = "https://openrouter.ai/api/v1"
SYNC_SECONDS = 6 * 60 * 60


class OpenRouterError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status


class OpenRouterClient:
    def __init__(self, http: httpx.AsyncClient, api_key: str | None, base_url: str | None = None) -> None:
        self.http = http
        self.api_key = api_key or ""
        self.base = (base_url or DEFAULT_BASE).rstrip("/")

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    async def models(self) -> dict:
        response = await self.http.get(f"{self.base}/models")
        response.raise_for_status()
        return response.json()

    async def complete(self, payload: dict) -> dict:
        response = await self.http.post(f"{self.base}/chat/completions", headers=self._headers(), json=payload)
        if response.status_code >= 400:
            raise OpenRouterError(response.status_code, response.text[:300])
        return response.json()

    async def stream(self, payload: dict) -> AsyncIterator[dict]:
        async with self.http.stream("POST", f"{self.base}/chat/completions", headers=self._headers(), json=payload) as response:
            if response.status_code >= 400:
                raise OpenRouterError(response.status_code, (await response.aread()).decode(errors="replace")[:300])
            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    return
                try:
                    yield json.loads(data)
                except ValueError:
                    continue


def _per_million(value) -> Decimal | None:
    try:
        price = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if price < 0:
        return None
    return (price * MILLION).normalize()


def parse_models(body: dict) -> list[Pricing]:
    """OpenRouter /models prices are USD per token as strings. Store them per 1M tokens. Routers priced -1 are skipped."""
    rows: list[Pricing] = []
    for item in body.get("data") or []:
        model_id = item.get("id")
        pricing = item.get("pricing") or {}
        prompt = _per_million(pricing.get("prompt"))
        completion = _per_million(pricing.get("completion"))
        if not model_id or prompt is None or completion is None:
            continue
        context = item.get("context_length")
        rows.append(Pricing(model_id, prompt, completion, int(context) if context else None))
    return rows


async def sync_pricing(client: OpenRouterClient, store) -> int:
    rows = parse_models(await client.models())
    return await store.upsert_pricing(rows)


async def pricing_loop(client: OpenRouterClient, store, interval: int = SYNC_SECONDS) -> None:
    while True:
        try:
            count = await sync_pricing(client, store)
            log.info("models_pricing synced rows=%d", count)
        except Exception as exc:  # noqa: BLE001 - keep the loop alive; the next run retries
            log.warning("models_pricing sync failed: %s", exc.__class__.__name__)
        await asyncio.sleep(interval)


def sync_interval() -> int:
    return int(os.environ.get("PRICING_SYNC_SECONDS", str(SYNC_SECONDS)))
