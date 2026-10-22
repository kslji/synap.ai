"""Item 2: the MySQL email/password auth must not be mounted.

Surf authenticates with email OTP only. The old /api/v1/auth/* router depended
on a MySQL instance the Postgres deployment never provisions, so /register
returned a 500. It is removed; these tests lock that in.
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["MAIL_MODE"] = "console"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_api_imports_without_mysql_database_module():
    # app.main imported above with no DATABASE_URL/MYSQL_DATABASE_URL present.
    assert app is not None


def test_mysql_auth_routes_are_not_registered():
    paths = set(app.openapi()["paths"].keys())
    for removed in (
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/google",
        "/api/v1/auth/github",
    ):
        assert removed not in paths, f"{removed} should no longer be mounted"
    assert not any(p.startswith("/api/v1/auth") for p in paths)


def test_register_returns_404_not_500():
    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/auth/register",
            json={"email": "sailor@example.com", "password": "hunter2hunter2"},
        )
        assert resp.status_code == 404, resp.text


def test_otp_auth_path_still_live():
    with TestClient(app) as client:
        started = client.post("/v1/auth/otp/start", json={"email": "sailor@example.com"})
        assert started.status_code == 200, started.text
        assert "dev_code" in started.json()
