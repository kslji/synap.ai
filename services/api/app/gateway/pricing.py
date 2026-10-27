"""Price sync from OpenRouter API."""
from __future__ import annotations

import asyncio
import logging
from decimal import Decimal
from typing import Any

import httpx

from .model_allowlist import allowed_ids

log = logging.getLogger("surf.gateway.pricing")

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


async def fetch_openrouter_models(
    http_client: httpx.AsyncClient,
    base_url: str = OPENROUTER_MODELS_URL,
) -> list[dict[str, Any]]:
    """Fetch model list from OpenRouter.
    
    Args:
        http_client: HTTP client to use
        base_url: OpenRouter models endpoint
        
    Returns:
        List of model data dicts
    """
    try:
        response = await http_client.get(base_url, timeout=10.0)
        response.raise_for_status()
        data = response.json()
        return data.get("data", [])
    except Exception as exc:
        log.error("failed to fetch OpenRouter models: %s", exc)
        return []


def parse_model_pricing(model_data: dict[str, Any]) -> tuple[str, Decimal, Decimal, int] | None:
    """Parse pricing from a model data dict.
    
    OpenRouter returns pricing as:
    {
      "id": "openai/gpt-4",
      "context_length": 8192,
      "pricing": {
        "prompt": "0.00003",  # per token
        "completion": "0.00006"  # per token
      }
    }
    
    Returns:
        (model_id, input_price_per_million, output_price_per_million, context_window) or None if invalid
    """
    try:
        model_id = model_data.get("id")
        if not model_id:
            return None
        
        pricing = model_data.get("pricing", {})
        if not pricing:
            return None
        
        # OpenRouter prices are per token; convert to per million
        prompt_price = pricing.get("prompt")
        completion_price = pricing.get("completion")
        
        if prompt_price is None or completion_price is None:
            return None
        
        # Convert to Decimal and handle string/float
        prompt_price_dec = Decimal(str(prompt_price))
        completion_price_dec = Decimal(str(completion_price))
        
        # Skip routers with -1 pricing (free/unavailable)
        if prompt_price_dec < 0 or completion_price_dec < 0:
            log.debug("skipping model %s with negative pricing", model_id)
            return None
        
        # Convert to per-million
        input_per_million = prompt_price_dec * Decimal("1000000")
        output_per_million = completion_price_dec * Decimal("1000000")
        
        context_window = int(model_data.get("context_length", 4096))
        
        return (model_id, input_per_million, output_per_million, context_window)
    except Exception as exc:
        log.warning("failed to parse pricing for model: %s", exc)
        return None


async def unpriced_allowlist_models(store: Any) -> list[str]:
    """Allowlisted models with no pricing row - i.e. ids upstream no longer serves.

    The allowlist is code and the price list is upstream data, so the two drift: when a
    slug is retired or renamed, it stays on the allowlist until someone picks it and
    gets an opaque provider error (``x-ai/grok-4`` did exactly that). Checking after
    every sync turns that into a warning the moment the gap opens.
    """
    missing: list[str] = []
    for model_id in allowed_ids():
        if not await store.get_model_pricing(model_id):
            missing.append(model_id)
    return missing


async def sync_pricing(
    store: Any,
    http_client: httpx.AsyncClient,
    base_url: str = OPENROUTER_MODELS_URL,
) -> int:
    """Sync pricing from OpenRouter to local database.
    
    Args:
        store: Gateway store instance
        http_client: HTTP client
        base_url: OpenRouter models endpoint
        
    Returns:
        Number of models synced
    """
    models = await fetch_openrouter_models(http_client, base_url)
    if not models:
        log.warning("no models returned from OpenRouter")
        return 0
    
    synced = 0
    for model_data in models:
        parsed = parse_model_pricing(model_data)
        if not parsed:
            continue
        
        model_id, input_price, output_price, context_window = parsed
        await store.upsert_model_pricing(
            model_id=model_id,
            input_price_per_million=input_price,
            output_price_per_million=output_price,
            context_window=context_window,
        )
        synced += 1
    
    log.info("synced pricing for %d models from OpenRouter", synced)
    # Only reached on a successful fetch: an empty/failed list must not look like the
    # whole allowlist went unpriced.
    gaps = await unpriced_allowlist_models(store)
    if gaps:
        log.warning(
            "allowlisted models with no upstream pricing (retired or renamed id?): %s",
            ", ".join(gaps),
        )
    return synced


async def pricing_sync_loop(
    store: Any,
    http_client: httpx.AsyncClient,
    interval_seconds: int,
    base_url: str = OPENROUTER_MODELS_URL,
) -> None:
    """Background loop to sync pricing at regular intervals.
    
    Args:
        store: Gateway store instance
        http_client: HTTP client
        interval_seconds: Seconds between syncs (0 to disable)
        base_url: OpenRouter models endpoint
    """
    if interval_seconds <= 0:
        log.info("pricing sync disabled (interval=0)")
        return
    
    while True:
        try:
            await sync_pricing(store, http_client, base_url)
        except Exception as exc:
            log.error("pricing sync failed: %s", exc)
        
        await asyncio.sleep(interval_seconds)
