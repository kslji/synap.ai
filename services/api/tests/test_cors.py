"""Item 11: CORS is an opt-in allowlist (app/cors.py), never "*" + credentials.

The desktop app and surf-ide extension are native clients and need no CORS, so
the secure default (empty CORS_ORIGINS) installs no middleware. When origins are
named they are served with credentials; a lone "*" is served without them.
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.cors import cors_kwargs, parse_origins  # noqa: E402
from app.main import app as real_app  # noqa: E402


def _build(raw: str) -> TestClient:
    a = FastAPI()
    kwargs = cors_kwargs(raw)
    if kwargs:
        a.add_middleware(CORSMiddleware, **kwargs)

    @a.get("/ping")
    def _ping():  # noqa: ANN202
        return {"ok": True}

    return TestClient(a)


def test_parse_origins_drops_blanks():
    assert parse_origins(" a.example , , b.example ") == ["a.example", "b.example"]


def test_empty_origins_install_nothing():
    assert cors_kwargs("") is None
    client = _build("")
    resp = client.get("/ping", headers={"Origin": "https://any.example"})
    assert "access-control-allow-origin" not in resp.headers


def test_allowed_origin_gets_cors_and_credentials():
    client = _build("https://ok.example,https://also.ok")
    resp = client.get("/ping", headers={"Origin": "https://ok.example"})
    assert resp.headers.get("access-control-allow-origin") == "https://ok.example"
    assert resp.headers.get("access-control-allow-credentials") == "true"


def test_disallowed_origin_gets_no_cors_header():
    client = _build("https://ok.example")
    resp = client.get("/ping", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in resp.headers


def test_wildcard_is_never_paired_with_credentials():
    kwargs = cors_kwargs("*")
    assert kwargs is not None and kwargs["allow_credentials"] is False
    client = _build("*")
    resp = client.get("/ping", headers={"Origin": "https://any.example"})
    assert resp.headers.get("access-control-allow-origin") == "*"
    assert "access-control-allow-credentials" not in resp.headers


def test_real_app_has_no_cors_by_default():
    # No CORS_ORIGINS in the test env -> the live app installs no CORS middleware.
    assert not os.environ.get("CORS_ORIGINS")
    assert not any(m.cls is CORSMiddleware for m in real_app.user_middleware)
