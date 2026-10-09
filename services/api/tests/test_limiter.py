import asyncio

from app.limiter import MemoryLimiter, judge


def test_judge_minute_then_day():
    status, retry = judge(11, 1, 10, 100, now=125)
    assert status == "rate_limited"
    assert retry == 60 - (125 % 60)
    status, retry = judge(1, 101, 10, 100, now=0)
    assert status == "quota_exceeded"
    assert retry == 3600
    assert judge(1, 1, 10, 100, now=0) == ("ok", None)


def test_memory_limiter_blocks_the_third_hit():
    limiter = MemoryLimiter(per_min=2, per_day=10)

    async def run():
        assert (await limiter.hit("device", now=1_700_000_000))[0] == "ok"
        assert (await limiter.hit("device", now=1_700_000_001))[0] == "ok"
        status, _ = await limiter.hit("device", now=1_700_000_002)
        assert status == "rate_limited"
        other, _ = await limiter.hit("someone-else", now=1_700_000_002)
        assert other == "ok"

    asyncio.run(run())
