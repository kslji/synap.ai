"""SURF_DEV_OPEN skips sign-in and quota only while the API is in lite mode."""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["SEARXNG_URL"] = "http://stub.local/search"
os.environ.pop("SURF_DEV_OPEN", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app, dev_bypass  # noqa: E402


class Stub:
    async def get(self, url, params=None, **kwargs):
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


def test_dev_bypass_requires_lite_mode():
    assert dev_bypass(True, "1") is True
    assert dev_bypass(False, "1") is False
    assert dev_bypass(True, None) is False
    assert dev_bypass(True, "0") is False


def test_search_still_requires_a_token_without_dev_open(monkeypatch):
    monkeypatch.delenv("SURF_DEV_OPEN", raising=False)
    with TestClient(app) as client:
        assert client.post("/v1/search", json={"query": "pier beacon"}).status_code == 401


def test_dev_open_skips_auth_and_quota_and_does_not_store_the_query(monkeypatch):
    monkeypatch.setenv("SURF_DEV_OPEN", "1")
    monkeypatch.setenv("SEARCH_PER_MIN", "1")
    monkeypatch.setenv("SEARCH_PER_DAY", "1")
    with TestClient(app) as client:
        app.state.http = Stub()
        app.state.audit.clear()
        for i in range(3):
            res = client.post("/v1/search", json={"query": f"pier beacon {i}", "k": 2})
            assert res.status_code == 200, res.text
            assert res.json()["results"][0]["url"] == "https://example.com/beacon"
        dumped = str(app.state.audit)
        assert "pier beacon" not in dumped
        assert all(row["query_text"] is None for row in app.state.audit)
        blocked = client.post("/v1/fetch", json={"urls": ["http://127.0.0.1/secret"]})
        assert blocked.status_code == 200
        assert blocked.json()["chunks"] == []
        assert blocked.json()["errors"][0]["code"] == "address"


def test_dev_open_does_nothing_when_the_server_is_not_lite(monkeypatch):
    monkeypatch.setenv("SURF_DEV_OPEN", "1")
    with TestClient(app) as client:
        app.state.lite = False
        assert client.post("/v1/search", json={"query": "pier beacon"}).status_code == 401
