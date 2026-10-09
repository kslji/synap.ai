import asyncio

from app.pages import clean_html, fetch_one
from app.ssrf import SsrfBlocked


class Stream:
    def __init__(self, status, headers, body=b""):
        self.status_code = status
        self.headers = headers
        self.body = body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def aiter_bytes(self):
        if self.body:
            yield self.body


class Client:
    def __init__(self, plan):
        self.plan = plan
        self.urls: list[str] = []

    def stream(self, method, url, headers=None, follow_redirects=False):
        self.urls.append(url)
        status, hdrs, body = self.plan[len(self.urls) - 1]
        return Stream(status, hdrs, body)


def test_clean_html_keeps_the_sentence():
    html = "<html><head><title>Pier 9</title></head><body><p>The Surf beacon code is SB-4417.</p></body></html>"
    text, title, _ = clean_html(html, "https://example.com/beacon")
    assert "SB-4417" in text
    assert title


def test_redirect_to_loopback_is_not_followed():
    client = Client([
        (404, {"content-type": "text/plain"}, b""),
        (302, {"location": "http://127.0.0.1/admin"}, b""),
    ])

    async def run():
        try:
            await fetch_one(client, "https://example.com/start", allow=set())
        except SsrfBlocked as exc:
            assert exc.reason == "address"
            return
        raise AssertionError("redirect was fetched")

    asyncio.run(run())
    assert client.urls == ["https://example.com/robots.txt", "https://example.com/start"]


def test_html_page_is_cleaned():
    page = b"<html><head><title>Pier</title></head><body><p>Beacon SB-4417 today.</p></body></html>"
    client = Client([
        (404, {"content-type": "text/plain"}, b""),
        (200, {"content-type": "text/html; charset=utf-8"}, page),
    ])

    async def run():
        return await fetch_one(client, "https://example.com/beacon", allow=set())

    result = asyncio.run(run())
    assert result["parts"]
    assert "SB-4417" in result["parts"][0]
    assert "127.0.0.1" not in "".join(client.urls)
