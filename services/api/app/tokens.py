"""Access tokens for a signed-in device.

`sub` is the devices.id, `aud` stays `authenticated`, algorithm stays HS256.
Search already verifies that shape. `uid` is the user. Step 3's anonymous
register issuer is gone; login is the only way to mint these.
"""
from __future__ import annotations

import os
import time

import jwt

ENV = os.environ


def issue_access_token(device_id: str, user_id: str, email: str, secret: str | None = None, audience: str | None = None, ttl_s: int = 15 * 60) -> dict:
    now = int(time.time())
    payload = {
        "sub": device_id,
        "uid": user_id,
        "email": email,
        "aud": audience or ENV.get("JWT_AUDIENCE", "authenticated"),
        "typ": "access",
        "iat": now,
        "exp": now + ttl_s,
    }
    token = jwt.encode(payload, secret or ENV["JWT_SECRET"], algorithm="HS256")
    return {"token": token, "token_type": "Bearer", "expires_in": ttl_s}


def read_bearer(authorization: str, secret: str | None = None, audience: str | None = None) -> dict:
    if not authorization.startswith("Bearer "):
        raise ValueError("missing bearer token")
    return jwt.decode(
        authorization[7:],
        secret or ENV["JWT_SECRET"],
        algorithms=["HS256"],
        audience=audience or ENV.get("JWT_AUDIENCE", "authenticated"),
    )
