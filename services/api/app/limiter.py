"""Per-device search counters. The query string is never part of the key or the record."""
from __future__ import annotations

import time


def judge(minute_count: int, day_count: int, per_min: int, per_day: int, now: int) -> tuple[str, int | None]:
    if minute_count > per_min:
        return "rate_limited", 60 - (now % 60)
    if day_count > per_day:
        return "quota_exceeded", 3600
    return "ok", None


class MemoryLimiter:
    def __init__(self, per_min: int, per_day: int):
        self.per_min = per_min
        self.per_day = per_day
        self.buckets: dict[str, int] = {}

    async def hit(self, sub: str, now: int | None = None) -> tuple[str, int | None]:
        now = int(time.time()) if now is None else now
        minute_key = f"{sub}:m:{now // 60}"
        day_key = f"{sub}:d:{now // 86400}"
        self.buckets[minute_key] = self.buckets.get(minute_key, 0) + 1
        self.buckets[day_key] = self.buckets.get(day_key, 0) + 1
        return judge(self.buckets[minute_key], self.buckets[day_key], self.per_min, self.per_day, now)


class RedisLimiter:
    def __init__(self, kv, per_min: int, per_day: int):
        self.kv = kv
        self.per_min = per_min
        self.per_day = per_day

    async def hit(self, sub: str, now: int | None = None) -> tuple[str, int | None]:
        now = int(time.time()) if now is None else now
        minute_key, day_key = f"rl:s:{sub}:{now // 60}", f"rl:d:{sub}:{now // 86400}"
        pipe = self.kv.pipeline()
        pipe.incr(minute_key)
        pipe.expire(minute_key, 70)
        pipe.incr(day_key)
        pipe.expire(day_key, 90000)
        per_min, _, per_day, _ = await pipe.execute()
        return judge(int(per_min), int(per_day), self.per_min, self.per_day, now)
