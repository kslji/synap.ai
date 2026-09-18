from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from config import settings

_hits: dict[str, deque[float]] = defaultdict(deque)


def rate_limit(request: Request, key: str) -> None:
    now = time.monotonic()
    window = 60.0
    q = _hits[key]
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= settings.chat_rate_per_minute:
        raise HTTPException(status_code=429, detail="Local rate limit exceeded")
    q.append(now)
