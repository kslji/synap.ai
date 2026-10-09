"""Production host checks. No Ollama required except one cached /health probe."""

from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="surf-host-test-"))
os.environ["PLATFORM_DATA_DIR"] = str(_TMP / "platform")
os.environ["LOCAL_AI_HOME"] = str(_TMP / "home")
os.environ["SURF_ENV"] = "development"
os.environ["ADMIN_EMAILS"] = "admin@example.com"
os.environ["ADMIN_PASSWORD"] = "correct-horse-battery"
os.environ["SMTP_HOST"] = ""
os.environ["SMTP_PASSWORD"] = ""
os.environ["LOG_LEVEL"] = "warning"
os.environ["AUTH_RATE_LIMIT"] = "100"
os.environ["AUTH_IP_RATE_LIMIT"] = "1000"
os.environ["OTP_RATE_LIMIT"] = "5"
os.environ["OTP_IP_RATE_LIMIT"] = "1000"
os.environ["LOGIN_RATE_LIMIT"] = "100"
os.environ["HEALTH_CACHE_SECONDS"] = "60"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from accounts import hash_secret  # noqa: E402
from auth import host_secret, mint_admin_token, mint_user_token  # noqa: E402
from client_ip import client_ip, is_direct_loopback  # noqa: E402
from config import settings  # noqa: E402
from mail_queue import _write_outbox  # noqa: E402
from platform_store import get_user_by_id, insert_user, platform_dir, set_user_password, set_user_verified  # noqa: E402
from rate_limit import _consume  # noqa: E402


class _Headers:
    def __init__(self, data: dict[str, str]) -> None:
        self._data = {key.lower(): value for key, value in data.items()}

    def get(self, name: str, default: str = "") -> str:
        return self._data.get(name.lower(), default)


class _Request:
    def __init__(self, host: str, headers: dict[str, str] | None = None) -> None:
        self.client = type("Client", (), {"host": host})()
        self.headers = _Headers(headers or {})


class HostProductionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(main.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.__exit__(None, None, None)

    def test_healthz_security_headers(self) -> None:
        res = self.client.get("/healthz")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"ok": True})
        self.assertEqual(res.headers["x-content-type-options"], "nosniff")
        self.assertEqual(res.headers["x-frame-options"], "DENY")
        self.assertEqual(res.headers["referrer-policy"], "no-referrer")
        self.assertTrue(res.headers.get("x-request-id"))

    def test_ready_and_health_keep_platform_bytes_zero(self) -> None:
        ready = self.client.get("/ready")
        self.assertEqual(ready.status_code, 200)
        self.assertTrue(ready.json()["ok"])
        health = self.client.get("/health")
        self.assertEqual(health.status_code, 200)
        body = health.json()
        self.assertEqual(body["privacy"]["platform_bytes"], 0)
        self.assertTrue(body["ok"])
        # TestClient is not a loopback peer, so filesystem paths stay off the public body.
        self.assertNotIn("user_home", json.dumps(body.get("platform") or {}))
        self.assertNotIn("data_dir", json.dumps(body))

    def test_forwarded_ip_only_from_loopback(self) -> None:
        local = _Request("127.0.0.1", {"x-forwarded-for": "203.0.113.8"})
        self.assertEqual(client_ip(local), "203.0.113.8")
        self.assertFalse(is_direct_loopback(local))
        direct = _Request("127.0.0.1")
        self.assertTrue(is_direct_loopback(direct))
        spoofed = _Request("203.0.113.9", {"x-forwarded-for": "198.51.100.4"})
        self.assertEqual(client_ip(spoofed), "203.0.113.9")

    def test_validation_error_keeps_detail_list(self) -> None:
        res = self.client.post(
            "/v1/auth/register",
            json={"email": "person@example.com", "password": "short"},
        )
        self.assertEqual(res.status_code, 422)
        body = res.json()
        self.assertIsInstance(body["detail"], list)
        self.assertEqual(body["code"], "validation_error")
        self.assertIn("msg", body["detail"][0])

    def test_login_missing_user_is_generic(self) -> None:
        res = self.client.post(
            "/v1/auth/login",
            json={"email": "nobody@example.com", "password": "password-ok-1"},
        )
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["detail"], "Email or password is wrong.")
        self.assertEqual(res.json()["code"], "unauthorized")

    def test_admin_failures_use_one_message(self) -> None:
        unknown = self.client.post(
            "/v1/admin/login",
            json={"email": "nope@example.com", "password": "whatever-password"},
        )
        wrong = self.client.post(
            "/v1/admin/login",
            json={"email": "admin@example.com", "password": "not-the-admin-password"},
        )
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.json()["detail"], "Admin sign-in failed.")
        self.assertEqual(wrong.json()["detail"], unknown.json()["detail"])

    def test_otp_email_budget(self) -> None:
        email = "limited@example.com"
        for _ in range(5):
            _consume(f"otp-email:{email}", 5, 900)
        res = self.client.post("/v1/auth/forgot", json={"email": email})
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.json()["code"], "rate_limited")
        self.assertIn("Too many attempts", res.json()["detail"])

    def test_register_writes_owner_only_outbox(self) -> None:
        email = "otp-reader@example.com"
        res = self.client.post(
            "/v1/auth/register",
            json={"email": email, "password": "password-ok-1"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        path = platform_dir() / "mail-outbox.jsonl"
        self.assertTrue(path.is_file())
        mode = stat.S_IMODE(path.stat().st_mode)
        self.assertEqual(mode, 0o600)
        last = json.loads(path.read_text(encoding="utf-8").strip().splitlines()[-1])
        self.assertEqual(last["to"], email)
        self.assertRegex(last["body"], r"\b\d{6}\b")

    def test_smtp_outbox_redacts_code(self) -> None:
        previous = settings.smtp_host
        settings.smtp_host = "smtp.example.com"
        try:
            _write_outbox("secret@example.com", "code", "Your code is 424242.", "job-redact")
        finally:
            settings.smtp_host = previous
        last = json.loads((platform_dir() / "mail-outbox.jsonl").read_text(encoding="utf-8").splitlines()[-1])
        self.assertEqual(last["body"], "[redacted]")
        self.assertNotIn("424242", last["body"])

    def test_feedback_is_scoped_and_password_reset_drops_old_token(self) -> None:
        first = insert_user("alice@example.com", hash_secret("password-ok-1"))
        second = insert_user("bob@example.com", hash_secret("password-ok-1"))
        set_user_verified(first["id"])
        set_user_verified(second["id"])
        alice = mint_user_token(get_user_by_id(first["id"]))
        bob = mint_user_token(get_user_by_id(second["id"]))
        created = self.client.post(
            "/v1/feedback",
            headers={"Authorization": f"Bearer {alice}"},
            json={"rating": "up", "title": "Hello", "message": "From Alice only."},
        )
        self.assertEqual(created.status_code, 200, created.text)
        bobs = self.client.get("/v1/feedback", headers={"Authorization": f"Bearer {bob}"})
        self.assertEqual(bobs.status_code, 200)
        self.assertEqual(bobs.json()["items"], [])
        alices = self.client.get("/v1/feedback", headers={"Authorization": f"Bearer {alice}"})
        self.assertEqual(len(alices.json()["items"]), 1)

        set_user_password(first["id"], hash_secret("a-new-password-2"))
        stale = self.client.get("/v1/auth/me", headers={"Authorization": f"Bearer {alice}"})
        self.assertEqual(stale.status_code, 401)
        fresh = mint_user_token(get_user_by_id(first["id"]))
        ok = self.client.get("/v1/auth/me", headers={"Authorization": f"Bearer {fresh}"})
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["email"], "alice@example.com")

    def test_purge_requires_admin(self) -> None:
        user = insert_user("purge-user@example.com", hash_secret("password-ok-1"))
        set_user_verified(user["id"])
        token = mint_user_token(get_user_by_id(user["id"]))
        denied = self.client.post("/v1/platform/purge", headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(denied.status_code, 401)
        admin = mint_admin_token("admin@example.com")
        allowed = self.client.post("/v1/platform/purge", headers={"Authorization": f"Bearer {admin}"})
        self.assertEqual(allowed.status_code, 200)
        self.assertTrue(allowed.json()["ok"])

    def test_jwt_secret_is_private_and_stable(self) -> None:
        first = host_secret()
        second = host_secret()
        self.assertEqual(first, second)
        path = platform_dir() / "jwt.secret"
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_oversized_body_is_rejected(self) -> None:
        previous = settings.max_body_bytes
        settings.max_body_bytes = 20
        try:
            res = self.client.post(
                "/v1/auth/login",
                json={"email": "person@example.com", "password": "password-ok-1"},
            )
        finally:
            settings.max_body_bytes = previous
        self.assertEqual(res.status_code, 413)
        self.assertEqual(res.json()["code"], "payload_too_large")

    def test_bad_otp_shape(self) -> None:
        res = self.client.post(
            "/v1/auth/verify-email",
            json={"email": "person@example.com", "otp": "abcdef"},
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("6-digit", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
