"""Item 4: pin the access-token guards already in main.current_user.

The check at services/api/app/main.py (typ == "access" + device_active) is not
rewritten here — these tests only prove it holds: a refresh token presented as
an access token is 401 (both the opaque wire token and a correctly signed JWT
carrying typ="refresh"), and an access token from a since-revoked device is
401. Runs on the LITE in-memory store like the rest of the auth suite.
"""
import os
import time

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["MAIL_MODE"] = "console"

import jwt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def _device(uid: str) -> dict:
    return {"device_uid": uid, "name": "Guard", "os": "linux", "arch": "x64", "app_version": "0.1.0"}


def _sign_in(client: TestClient, email: str, uid: str) -> dict:
    started = client.post("/v1/auth/otp/start", json={"email": email})
    assert started.status_code == 200, started.text
    code = started.json()["dev_code"]
    verified = client.post(
        "/v1/auth/otp/verify", json={"email": email, "code": code, "device": _device(uid)}
    )
    assert verified.status_code == 200, verified.text
    return verified.json()


def test_opaque_refresh_token_is_rejected_as_an_access_token():
    with TestClient(app) as client:
        session = _sign_in(client, "guard1@example.com", "g1")
        bad = client.get(
            "/v1/account", headers={"Authorization": f"Bearer {session['refresh_token']}"}
        )
        assert bad.status_code == 401
        assert bad.json()["error"]["code"] == "invalid_token"


def test_refresh_typed_jwt_is_rejected_as_an_access_token():
    # Same secret, same audience, same claims — only the typ is wrong. This is
    # the branch in current_user (claims.get("typ") != "access") being pinned.
    with TestClient(app) as client:
        session = _sign_in(client, "guard2@example.com", "g2")
        now = int(time.time())
        forged = jwt.encode(
            {
                "sub": session["device"]["id"],
                "uid": session["user"]["id"],
                "aud": os.environ["JWT_AUDIENCE"],
                "typ": "refresh",
                "iat": now,
                "exp": now + 900,
            },
            os.environ["JWT_SECRET"],
            algorithm="HS256",
        )
        bad = client.get("/v1/account", headers={"Authorization": f"Bearer {forged}"})
        assert bad.status_code == 401
        assert bad.json()["error"]["code"] == "invalid_token"
        # sanity: the real access token for the same device still works
        ok = client.get(
            "/v1/account", headers={"Authorization": f"Bearer {session['access_token']}"}
        )
        assert ok.status_code == 200


def test_access_token_from_a_revoked_device_is_rejected():
    with TestClient(app) as client:
        session = _sign_in(client, "guard3@example.com", "g3")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        assert client.get("/v1/account", headers=headers).status_code == 200

        revoked = client.post(
            f"/v1/devices/{session['device']['id']}/revoke", headers=headers
        )
        assert revoked.status_code == 200, revoked.text

        after = client.get("/v1/account", headers=headers)
        assert after.status_code == 401
        assert after.json()["error"]["code"] == "invalid_token"
