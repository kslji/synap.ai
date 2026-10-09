import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["SEARXNG_URL"] = "http://stub.local/search"
os.environ["SEARCH_PER_MIN"] = "4"
os.environ["SEARCH_PER_DAY"] = "20"
os.environ["FETCH_ALLOW_HOSTS"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


class Stub:
    def __init__(self):
        self.calls = []

    async def get(self, url, params=None, **kwargs):
        self.calls.append((url, params))

        class Response:
            status_code = 200

            def raise_for_status(self):
                return None

            def json(self):
                return {"results": [{
                    "title": "Pier 9 beacon",
                    "url": "https://example.com/beacon",
                    "content": "The Surf beacon code is SB-4417.",
                    "publishedDate": "2026-10-09",
                }]}

        return Response()

    async def aclose(self):
        return None


def test_search_requires_a_device_token_and_does_not_store_the_query():
    with TestClient(app) as client:
        stub = Stub()
        app.state.http = stub
        assert client.post("/v1/search", json={"query": "pier beacon"}).status_code == 401
        assert client.post("/v1/devices/register", json={}).status_code == 410
        started = client.post("/v1/auth/otp/start", json={"email": "searcher@example.com"})
        assert started.status_code == 200
        verified = client.post("/v1/auth/otp/verify", json={
            "email": "searcher@example.com",
            "code": started.json()["dev_code"],
            "device": {"device_uid": "search-box", "name": "Search", "os": "linux", "arch": "x64", "app_version": "0.1.0"},
        })
        assert verified.status_code == 200, verified.text
        headers = {"authorization": f"Bearer {verified.json()['access_token']}"}
        first = client.post("/v1/search", headers=headers, json={"query": "pier beacon code", "k": 3})
        assert first.status_code == 200
        body = first.json()
        assert body["results"][0]["title"] == "Pier 9 beacon"
        assert body["results"][0]["published"] == "2026-10-09"
        assert body["cached"] is False
        second = client.post("/v1/search", headers=headers, json={"query": "pier beacon code", "k": 3})
        assert second.json()["cached"] is True
        assert sum(1 for url, _ in stub.calls if str(url).endswith("/search")) == 1
        dumped = str(app.state.audit)
        assert "pier beacon" not in dumped
        assert all(row["query_text"] is None for row in app.state.audit)
        blocked = client.post("/v1/fetch", headers=headers, json={"urls": ["http://127.0.0.1/secret", "http://169.254.169.254/"]})
        assert blocked.status_code == 200
        assert blocked.json()["chunks"] == []
        assert {item["code"] for item in blocked.json()["errors"]} == {"address"}
        assert client.post("/v1/search", headers=headers, json={"q": "fourth"}).status_code == 200
        limited = client.post("/v1/search", headers=headers, json={"q": "fifth"})
        assert limited.status_code == 429
        assert limited.json()["error"]["code"] == "rate_limited"
