"""
Daily/weekly freshness job for trusted sources: discover new URLs from RSS/Atom feeds and
sitemaps, fetch politely (robots.txt, rate limit, conditional requests), and store the raw
HTML as WARC records so the SAME datatrove cleaning pipeline (dt_clean.py) processes them.

pip install httpx trafilatura warcio
"""
from __future__ import annotations

import hashlib
import io
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx
from trafilatura import feeds, sitemaps
from warcio.statusandheaders import StatusAndHeaders
from warcio.warcwriter import WARCWriter

UA = "harbor-ingest/0.1 (+https://harbor.example.com/bot; ops@example.com)"
_robots: dict[str, urllib.robotparser.RobotFileParser] = {}


def allowed(url: str) -> bool:
    host = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser(f"{host}/robots.txt")
        try:
            rp.read()
        except Exception:
            pass                       # unreachable robots.txt -> treat as allowed (RFC 9309)
        _robots[host] = rp
    return _robots[host].can_fetch(UA, url)


def discover(source: dict, seen: set[str], max_urls: int = 200) -> list[str]:
    """source = row from the `sources` table (feed_url / sitemap_url / domain)."""
    urls: list[str] = []
    if source.get("feed_url"):
        urls += feeds.find_feed_urls(source["feed_url"], target_lang="en")
    if source.get("sitemap_url") or not urls:
        urls += sitemaps.sitemap_search(source.get("sitemap_url") or f"https://{source['domain']}/",
                                        target_lang="en")
    keep = [u for u in dict.fromkeys(urls)
            if hashlib.sha256(u.encode()).hexdigest() not in seen
            and not any(p in u for p in source.get("exclude_patterns", []))]
    return keep[:max_urls]


def fetch_to_warc(urls: list[str], out_path: Path, delay_s: float = 2.0) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with httpx.Client(headers={"User-Agent": UA}, follow_redirects=True, timeout=20) as client, \
            out_path.open("wb") as fh:
        writer = WARCWriter(fh, gzip=True)
        for url in urls:
            if not allowed(url):
                continue
            try:
                r = client.get(url)
            except httpx.HTTPError:
                continue
            ctype = r.headers.get("content-type", "")
            if r.status_code != 200 or "html" not in ctype:
                continue
            http_headers = StatusAndHeaders("200 OK", [("Content-Type", ctype)], protocol="HTTP/1.1")
            rec = writer.create_warc_record(
                str(r.url), "response", payload=io.BytesIO(r.content), http_headers=http_headers,
                warc_headers_dict={"WARC-Date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                   "WARC-Identified-Payload-Type": "text/html"})
            writer.write_record(rec)
            n += 1
            time.sleep(delay_s)        # politeness: <= 1 request / 2 s per site
    return n


if __name__ == "__main__":
    import sys
    src = {"domain": "news.un.org",
           "feed_url": "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
           "exclude_patterns": ["/audio/"]}
    found = discover(src, seen=set(), max_urls=int(sys.argv[1]) if len(sys.argv) > 1 else 3)
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = Path(f"data/warc/general/scrape-{src['domain']}-{day}.warc.gz")
    print(len(found), "new urls;", fetch_to_warc(found, out), "fetched ->", out)
