"""
Step 1 of the monthly niche crawl: query the Common Crawl CDX index for ONE domain
and range-fetch only the matching WARC records (no full-WARC downloads).

Each CC record is stored as an independent gzip member inside the big .warc.gz,
so concatenating the fetched byte ranges produces a valid local .warc.gz that
datatrove's WarcReader (or warcio) can read.

pip install httpx warcio
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import httpx

CDX_BASE = "https://index.commoncrawl.org"
DATA_BASE = "https://data.commoncrawl.org"
UA = {"User-Agent": "harbor-ingest/0.1 (contact: ops@example.com)"}  # identify yourself


def latest_crawl_id(client: httpx.Client) -> str:
    """collinfo.json lists crawls newest-first (e.g. 'CC-MAIN-2026-39' on 8 Oct 2026)."""
    r = client.get(f"{CDX_BASE}/collinfo.json", timeout=30)
    r.raise_for_status()
    return r.json()[0]["id"]


def _get(client: httpx.Client, url: str, params: dict, tries: int = 6) -> httpx.Response | None:
    """GET with polite exponential back-off: the index server answers 503 when busy."""
    for attempt in range(tries):
        r = client.get(url, params=params, timeout=120)
        if r.status_code == 200:
            return r
        if r.status_code == 404:          # "No Captures found for: ..."
            return None
        time.sleep(min(2 ** attempt * 5, 120))
    raise RuntimeError(f"{url} failed after {tries} tries: HTTP {r.status_code}")


def cdx_query(client: httpx.Client, crawl_id: str, url_pattern: str, max_pages: int = 50):
    """Yield CDX rows (dicts) for e.g. url_pattern='imo.org/*'. Handles pagination."""
    endpoint = f"{CDX_BASE}/{crawl_id}-index"
    base = {"url": url_pattern, "output": "json",
            "filter": ["status:200", "mime-detected:text/html"]}
    r = _get(client, endpoint, {**base, "showNumPages": "true"})
    if r is None:
        return
    for page in range(min(r.json()["pages"], max_pages)):
        r = _get(client, endpoint, {**base, "page": page})
        if r is None:
            return
        for line in r.text.splitlines():
            if line.strip():
                yield json.loads(line)


def fetch_record(client: httpx.Client, row: dict) -> bytes:
    """HTTP Range request for one gzip-compressed WARC record."""
    start = int(row["offset"])
    end = start + int(row["length"]) - 1
    r = client.get(f"{DATA_BASE}/{row['filename']}",
                   headers={"Range": f"bytes={start}-{end}"}, timeout=60)
    r.raise_for_status()  # expect 206 Partial Content
    return r.content


def crawl_domain(domain: str, out_dir: Path, crawl_id: str | None = None,
                 limit: int = 500, langs: tuple[str, ...] = ("eng",)) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    with httpx.Client(headers=UA, follow_redirects=True) as client:
        crawl_id = crawl_id or latest_crawl_id(client)
        out = out_dir / f"{domain.replace('.', '_')}-{crawl_id}.warc.gz"
        seen_digests: set[str] = set()      # exact-duplicate payloads (CDX 'digest')
        n = 0
        with out.open("wb") as f:
            for row in cdx_query(client, crawl_id, f"{domain}/*"):
                if langs and not any(l in row.get("languages", "") for l in langs):
                    continue
                if row["digest"] in seen_digests:
                    continue
                seen_digests.add(row["digest"])
                f.write(fetch_record(client, row))
                n += 1
                if n >= limit:
                    break
                time.sleep(0.2)              # be gentle with data.commoncrawl.org
    print(f"{domain}: wrote {n} records from {crawl_id} -> {out}")
    return out


if __name__ == "__main__":
    import sys
    crawl_domain(sys.argv[1] if len(sys.argv) > 1 else "imo.org",
                 Path("data/warc"), limit=int(sys.argv[2]) if len(sys.argv) > 2 else 20)
