import os

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["SEARXNG_URL"] = "http://stub.local/search"
os.environ["MAIL_MODE"] = "console"
os.environ["MAX_DEVICES"] = "2"
os.environ["FETCH_ALLOW_HOSTS"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.otp_policy import judge_otp, hash_code  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402


def _device(uid: str, name: str = "Desk") -> dict:
    return {"device_uid": uid, "name": name, "os": "linux", "arch": "x64", "app_version": "0.1.0"}


def _verify(client: TestClient, email: str, uid: str):
    started = client.post("/v1/auth/otp/start", json={"email": email})
    assert started.status_code == 200, started.text
    code = started.json()["dev_code"]
    verified = client.post("/v1/auth/otp/verify", json={"email": email, "code": code, "device": _device(uid)})
    return verified


def test_judge_otp_locks_on_the_fifth_wrong_guess():
    now = datetime.now(timezone.utc)
    row = {"code_hash": hash_code("123456"), "expires_at": now + timedelta(minutes=5), "attempts": 4}
    assert judge_otp(row, "000000", now) == "locked"
    assert judge_otp({"code_hash": hash_code("123456"), "expires_at": now + timedelta(minutes=5), "attempts": 0}, "123456", now) == "ok"
    assert judge_otp({"code_hash": hash_code("123456"), "expires_at": now - timedelta(seconds=1), "attempts": 0}, "123456", now) == "expired"


def test_otp_attempt_limit_and_resend_cooldown():
    with TestClient(app) as client:
        email = "sailor@example.com"
        first = client.post("/v1/auth/otp/start", json={"email": email})
        assert first.status_code == 200
        again = client.post("/v1/auth/otp/start", json={"email": email})
        assert again.status_code == 429
        assert again.json()["error"]["code"] == "resend_cooldown"
        code = first.json()["dev_code"]
        for _ in range(4):
            bad = client.post("/v1/auth/otp/verify", json={"email": email, "code": "000000", "device": _device("d1")})
            assert bad.status_code == 400
        locked = client.post("/v1/auth/otp/verify", json={"email": email, "code": "000000", "device": _device("d1")})
        assert locked.status_code == 429
        assert locked.json()["error"]["code"] == "too_many_attempts"
        # The real code was consumed with the lock. A fresh code still works after we age the cooldown.
        app.state.auth.otps[-1]["created_at"] = datetime.now(timezone.utc) - timedelta(seconds=120)
        started = client.post("/v1/auth/otp/start", json={"email": email})
        assert started.status_code == 200
        ok = client.post("/v1/auth/otp/verify", json={"email": email, "code": started.json()["dev_code"], "device": _device("d1")})
        assert ok.status_code == 200
        assert ok.json()["user"]["email"] == email
        assert code != started.json()["dev_code"]


def test_refresh_rotation_detects_reuse_and_device_revoke():
    with TestClient(app) as client:
        email = "bridge@example.com"
        first = _verify(client, email, "laptop")
        assert first.status_code == 200, first.text
        body = first.json()
        rotated = client.post("/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
        assert rotated.status_code == 200
        reused = client.post("/v1/auth/refresh", json={"refresh_token": body["refresh_token"]})
        assert reused.status_code == 401
        assert reused.json()["error"]["code"] == "refresh_reused"
        stale = client.post("/v1/auth/refresh", json={"refresh_token": rotated.json()["refresh_token"]})
        assert stale.status_code == 401

        second = _verify(client, email, "phone")
        assert second.status_code == 200
        third = _verify(client, email, "tablet")
        assert third.status_code == 403
        assert third.json()["error"]["code"] == "device_limit"
        headers = {"authorization": f"Bearer {second.json()['access_token']}"}
        listed = client.get("/v1/devices", headers=headers)
        assert listed.status_code == 200
        ids = [row["id"] for row in listed.json()["devices"] if row["status"] == "active"]
        assert len(ids) == 2
        gone = client.post(f"/v1/devices/{second.json()['device']['id']}/revoke", headers=headers)
        assert gone.status_code == 200
        blocked = client.get("/v1/account", headers=headers)
        assert blocked.status_code == 401
        again = _verify(client, email, "tablet")
        assert again.status_code == 200
