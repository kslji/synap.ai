"""Item 5: when the OTP mail cannot be sent, /v1/auth/otp/start answers 503 with a typed error.

Two failure modes are forbidden: a raw 500 (the exception escaping the route)
and a silent success ({"ok": true} while no code ever reached the mailer).
"""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["MAIL_MODE"] = "console"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


class _FailingMail:
    """Stands in for SmtpMail with a broken/misconfigured host."""

    def __init__(self) -> None:
        self.attempts = 0

    def send(self, to: str, subject: str, body: str, code: str) -> None:
        self.attempts += 1
        raise RuntimeError("SMTP_HOST is empty")


def test_otp_start_returns_503_typed_error_when_mail_fails():
    with TestClient(app, raise_server_exceptions=False) as client:
        broken = _FailingMail()
        app.state.mail = broken
        response = client.post("/v1/auth/otp/start", json={"email": "stranded@example.com"})
        assert broken.attempts == 1
        assert response.status_code == 503, response.text
        assert response.json()["error"]["code"] == "mail_unavailable"
        # Never the silent-success shape either.
        body = response.json()
        assert not (body.get("ok") is True or "dev_code" in body)


def test_otp_start_succeeds_when_the_mailer_works():
    with TestClient(app) as client:
        response = client.post("/v1/auth/otp/start", json={"email": "delivered@example.com"})
        assert response.status_code == 200
        assert "dev_code" in response.json()
