from __future__ import annotations

import json
import os
import subprocess
from typing import Any, AsyncIterator

import httpx

from config import settings

RAM_HINTS = {
    "llama3.2:1b": {"ram_gb": 1.2, "label": "Light"},
    "llama3.2:3b": {"ram_gb": 2.4, "label": "Balanced"},
    "qwen2.5:1.5b": {"ram_gb": 1.3, "label": "Light"},
    "qwen2.5:3b": {"ram_gb": 2.5, "label": "Balanced"},
    "phi3:mini": {"ram_gb": 2.6, "label": "Balanced"},
    "mistral:7b": {"ram_gb": 5.8, "label": "Quality"},
    "llama3.1:8b": {"ram_gb": 6.5, "label": "Quality"},
    "llama3.1:8b-instruct": {"ram_gb": 6.5, "label": "Quality"},
    "gemma2:9b": {"ram_gb": 7.5, "label": "Quality"},
    "llama3.1:14b": {"ram_gb": 10.0, "label": "Heavy"},
    "qwen2.5:14b": {"ram_gb": 10.0, "label": "Heavy"},
    "qwen2.5:32b": {"ram_gb": 22.0, "label": "Workstation"},
    "llama3.3:70b": {"ram_gb": 42.0, "label": "Workstation"},
}


def ram_for(model: str) -> dict:
    low = model.lower()
    if model in RAM_HINTS:
        return RAM_HINTS[model]
    for name, hint in RAM_HINTS.items():
        if name in low or name.replace(":", "-") in low:
            return hint
    if "70b" in low:
        return {"ram_gb": 42.0, "label": "Workstation"}
    if "32b" in low or "34b" in low:
        return {"ram_gb": 22.0, "label": "Workstation"}
    if "13b" in low or "14b" in low:
        return {"ram_gb": 10.0, "label": "Heavy"}
    if "8b" in low or "7b" in low or "9b" in low:
        return {"ram_gb": 6.5, "label": "Quality"}
    if "3b" in low:
        return {"ram_gb": 2.4, "label": "Balanced"}
    if "1b" in low or "1.5b" in low or "2b" in low:
        return {"ram_gb": 1.3, "label": "Light"}
    return {"ram_gb": 2.5, "label": "Custom"}


def cpu_threads() -> int:
    if settings.num_thread > 0:
        return settings.num_thread
    n = os.cpu_count() or 4
    return max(2, n - 1)


def total_ram_gb() -> float:
    try:
        out = subprocess.check_output(["sysctl", "-n", "hw.memsize"], timeout=1, stderr=subprocess.DEVNULL)
        return round(int(out.strip()) / (1024**3), 1)
    except (OSError, subprocess.SubprocessError, ValueError):
        pass
    try:
        pages = os.sysconf("SC_PHYS_PAGES")
        size = os.sysconf("SC_PAGE_SIZE")
        return round((pages * size) / (1024**3), 1)
    except (ValueError, OSError):
        return 8.0


def pick_local_model(installed: list[str]) -> str:
    """Best already-loaded local model that fits this machine. Never auto-downloads.

    On low-RAM hosts prefer light tags (llama3.2:1b) so chat stays usable.
    """
    names = [n for n in installed if n]
    if not names:
        return settings.default_model
    ram = total_ram_gb()
    scored: list[tuple[float, str]] = []
    for name in names:
        need = float(ram_for(name)["ram_gb"]) + 2.0
        if need > ram:
            continue
        scored.append((need, name))
    if not scored:
        # Nothing fits the +2 GB headroom rule — still prefer the lightest installed.
        light = sorted(names, key=lambda n: float(ram_for(n)["ram_gb"]))
        return light[0]
    if ram < 5.5:
        light = sorted(scored, key=lambda row: row[0])
        for need, name in light:
            if "1b" in name.lower() or "1.5b" in name.lower() or "2b" in name.lower():
                return name
        return light[0][1]
    scored.sort(reverse=True)
    preferred = settings.default_model
    if preferred in names and float(ram_for(preferred)["ram_gb"]) + 2.0 <= ram:
        top = scored[0][1]
        if ram_for(top)["ram_gb"] <= ram_for(preferred)["ram_gb"] + 0.3:
            return preferred
        return top
    return scored[0][1]


def ollama_options(model: str | None = None) -> dict[str, Any]:
    low = (model or settings.default_model).lower()
    light = "1b" in low or "1.5b" in low or "2b" in low
    # Leave headroom for the reply. Overfilling num_ctx makes Ollama stop mid-word.
    ctx = min(settings.num_ctx, 4096) if light else settings.num_ctx
    opts: dict[str, Any] = {
        "num_ctx": ctx,
        "num_thread": cpu_threads(),
        "num_batch": 256 if light else 512,
        "use_mmap": True,
    }
    if light:
        # Small models invent less when temperature is low and answers stay short.
        opts["temperature"] = 0.2
        opts["top_p"] = 0.9
        opts["num_predict"] = 512
    else:
        opts["num_predict"] = 1024
    return opts


def _bases() -> dict[str, str]:
    return {
        "ollama": settings.ollama_base.rstrip("/"),
        "colibri": settings.colibri_base.rstrip("/"),
        "lmstudio": settings.lmstudio_base.rstrip("/"),
        "llamacpp": settings.llamacpp_base.rstrip("/"),
    }


async def ollama_alive() -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"{_bases()['ollama']}/api/tags")
            return r.status_code == 200
    except httpx.HTTPError:
        return False


async def _openai_models(base: str) -> list[str]:
    async with httpx.AsyncClient(timeout=1.5) as client:
        last_exc: httpx.HTTPError | None = None
        for path in ("/v1/models", "/models"):
            try:
                r = await client.get(f"{base}{path}")
                r.raise_for_status()
                data = r.json()
                ids = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
                if ids:
                    return ids
                if r.status_code == 200:
                    return ["local"]
            except httpx.HTTPError as exc:
                last_exc = exc
                continue
        if last_exc:
            raise last_exc
        return []


async def _ollama_models() -> list[str]:
    async with httpx.AsyncClient(timeout=1.5) as client:
        r = await client.get(f"{_bases()['ollama']}/api/tags")
        r.raise_for_status()
        data = r.json()
        return [m.get("name", "") for m in data.get("models", []) if m.get("name")]


async def detect_engine() -> dict[str, Any]:
    """Probe loopback servers that are actually up. No cloud providers."""
    preferred = (settings.local_llm or "auto").strip().lower()
    # Ollama first for everyday zip flow; Colibri when user started coli serve (:8000).
    order = ["ollama", "colibri", "lmstudio", "llamacpp"]
    if preferred in order:
        order = [preferred] + [x for x in order if x != preferred]
    found: list[dict[str, Any]] = []
    for kind in order:
        base = _bases()[kind]
        try:
            models = await (_ollama_models() if kind == "ollama" else _openai_models(base))
        except httpx.HTTPError:
            continue
        if not models and kind != "llamacpp":
            continue
        found.append({"backend": kind, "url": base, "models": models})
    active = found[0] if found else None
    return {
        "backend": None if active is None else active["backend"],
        "url": None if active is None else active["url"],
        "models": [] if active is None else active["models"],
        "available": found,
        "note": "Ollama :11434, Colibri :8000, LM Studio :1234, llama.cpp :8080. Never OpenAI/Anthropic.",
    }


async def local_engine_alive() -> bool:
    snap = await detect_engine()
    return snap["backend"] is not None


async def list_models() -> list[str]:
    snap = await detect_engine()
    return list(snap.get("models") or [])


async def pull_model(model: str) -> dict:
    async with httpx.AsyncClient(timeout=None) as client:
        r = await client.post(
            f"{_bases()['ollama']}/api/pull",
            json={"name": model, "stream": False},
        )
        r.raise_for_status()
        return r.json() if r.content else {"status": "ok"}


async def stream_chat(
    model: str, messages: list[dict[str, str]], engine: dict[str, Any] | None = None
) -> AsyncIterator[str]:
    snap = engine or await detect_engine()
    backend = snap.get("backend")
    if backend == "ollama":
        async for line in _stream_ollama(model, messages):
            yield line
        return
    if backend in {"lmstudio", "llamacpp", "colibri"}:
        async for line in _stream_openai(str(snap["url"]), model, messages):
            yield line
        return
    raise httpx.ConnectError("No local model server")


async def _stream_ollama(model: str, messages: list[dict[str, str]]) -> AsyncIterator[str]:
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "keep_alive": settings.keep_alive,
        "options": ollama_options(model),
    }
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST", f"{_bases()['ollama']}/api/chat", json=payload
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    yield line


async def _stream_openai(base: str, model: str, messages: list[dict[str, str]]) -> AsyncIterator[str]:
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.4,
    }
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{base}/v1/chat/completions",
            json=payload,
            headers={"Content-Type": "application/json"},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    yield json.dumps({"done": True})
                    return
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                piece = ((choices[0].get("delta") or {}).get("content")) or ""
                if piece:
                    yield json.dumps({"message": {"content": piece}})
            yield json.dumps({"done": True})
