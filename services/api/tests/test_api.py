import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_search_and_fetch_routes_are_gone():
    with TestClient(app) as client:
        assert client.post("/v1/search", json={"query": "pier beacon"}).status_code == 404
        assert client.post("/v1/fetch", json={"urls": ["https://example.com"]}).status_code == 404
        assert client.post("/v1/devices/register", json={}).status_code == 410
        health = client.get("/v1/health").json()
        assert "searxng" not in health
