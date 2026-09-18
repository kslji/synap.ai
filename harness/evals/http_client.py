from __future__ import annotations

import json
import urllib.error
import urllib.request

HOST = "http://127.0.0.1:18765"


def get_json(path: str, token: str | None = None, timeout: int = 8):
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(f"{HOST}{path}", headers=headers)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def post_json(path: str, data: dict, token: str | None = None, timeout: int = 8):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(
        f"{HOST}{path}",
        data=json.dumps(data).encode(),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def stream_chat(token: str, prompt: str, timeout: int = 120) -> tuple[str, dict]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    r = urllib.request.Request(
        f"{HOST}/v1/chat",
        data=json.dumps({"content": prompt, "offline": True}).encode(),
        headers=headers,
        method="POST",
    )
    text = ""
    meta: dict = {}
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        for line in resp:
            line = line.decode().strip()
            if not line.startswith("data: "):
                continue
            payload = json.loads(line[6:])
            if payload.get("type") == "meta":
                meta = payload
            elif payload.get("type") == "delta":
                text += payload.get("content") or ""
            elif payload.get("type") == "error":
                raise RuntimeError(payload.get("detail") or "chat error")
    return text, meta
