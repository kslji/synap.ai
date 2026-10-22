"""Item 3: /v1/health must return 200 with no SearXNG, and search is gone.

Web search was removed entirely (no SearXNG, no /v1/search, no /v1/fetch). The
health endpoint must therefore report only postgres/valkey and return 200 in
lite mode without any SEARXNG_URL configured.
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ.pop("SEARXNG_URL", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.version import app_version  # noqa: E402


def test_health_reports_the_app_version():
    with TestClient(app) as client:
        body = client.get("/v1/health").json()
        assert body["version"] == app_version()


def test_health_returns_200_without_searxng():
    with TestClient(app) as client:
        resp = client.get("/v1/health")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "ok"
        assert "searxng" not in body


def test_search_and_fetch_routes_are_gone():
    paths = set(app.openapi()["paths"].keys())
    assert "/v1/search" not in paths
    assert "/v1/fetch" not in paths


def test_search_and_fetch_return_404():
    with TestClient(app) as client:
        assert client.post("/v1/search", json={"query": "pier beacon"}).status_code == 404
        assert client.post("/v1/fetch", json={"urls": ["https://example.com"]}).status_code == 404
