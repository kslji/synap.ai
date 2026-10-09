"""Fetch a public HTML page and return cleaned text. Nothing is written to disk or the database."""
from __future__ import annotations

import re
from urllib.parse import urlsplit

import httpx

from .ssrf import MAX_BYTES, SsrfBlocked, guard_url, next_hop, robots_allows

USER_AGENT = "SurfAI/0.1 (+https://synap.surf)"


def _strip_html(raw: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:8000]


def clean_html(raw: str, url: str) -> tuple[str, str | None, str | None]:
    title = None
    published = None
    try:
        import trafilatura

        text = trafilatura.extract(raw, url=url, include_comments=False) or ""
        meta = trafilatura.extract_metadata(raw, default_url=url)
        if meta is not None:
            title = meta.title or None
            published = meta.date or None
        if text.strip():
            return text.strip()[:8000], title, published
    except Exception:
        pass
    match = re.search(r"(?is)<title[^>]*>(.*?)</title>", raw)
    if match:
        title = re.sub(r"\s+", " ", match.group(1)).strip()[:200] or None
    return _strip_html(raw), title, published


def slices(text: str, size: int = 1500, limit: int = 3) -> list[str]:
    body = text.strip()
    if not body:
        return []
    parts = []
    start = 0
    while start < len(body) and len(parts) < limit:
        parts.append(body[start:start + size])
        start += size
    return parts


async def _read_limited(response: httpx.Response) -> bytes:
    length = response.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BYTES:
        raise SsrfBlocked("size")
    buf = bytearray()
    async for block in response.aiter_bytes():
        buf.extend(block)
        if len(buf) > MAX_BYTES:
            raise SsrfBlocked("size")
    return bytes(buf)


async def fetch_one(client: httpx.AsyncClient, url: str, allow: set[str]) -> dict:
    """Follow a few redirects, re-checking each hop, and return cleaned slices."""
    current = guard_url(url, allow)
    robots = robots_url(current)
    try:
        guard_url(robots, allow)
        async with client.stream("GET", robots, headers={"user-agent": USER_AGENT}, follow_redirects=False) as robots_res:
            if robots_res.status_code == 200:
                body = (await _read_limited(robots_res)).decode("utf-8", "replace")
                if not robots_allows(body, current):
                    raise SsrfBlocked("robots")
    except SsrfBlocked:
        raise
    except (httpx.HTTPError, OSError, UnicodeError):
        pass
    for _ in range(4):
        current = guard_url(current, allow)
        async with client.stream("GET", current, headers={"user-agent": USER_AGENT, "accept": "text/html"}, follow_redirects=False) as response:
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise SsrfBlocked("redirect")
                current = next_hop(current, location)
                continue
            if response.status_code != 200:
                raise SsrfBlocked("http")
            ctype = (response.headers.get("content-type") or "").lower()
            if "html" not in ctype and "text/plain" not in ctype:
                raise SsrfBlocked("html")
            raw = (await _read_limited(response)).decode("utf-8", "replace")
            text, title, published = clean_html(raw, current)
            return {
                "url": current,
                "title": title,
                "published": published,
                "parts": slices(text),
            }
    raise SsrfBlocked("redirect")


def robots_url(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}/robots.txt"
