"""Temporary device tokens.

Step 5 replaces this HMAC JWT with the real login session. The claim shape
(`sub`, `aud`, HS256) matches the verifier already used by /v1/search, so the
swap is the issuer, not the desktop call.
"""
from __future__ import annotations

import os
import time
import uuid

import jwt

ENV = os.environ


def issue_device_token(secret: str | None = None, audience: str | None = None, ttl_s: int = 30 * 24 * 3600) -> dict:
    now = int(time.time())
    device_id = str(uuid.uuid4())
    payload = {
        "sub": device_id,
        "aud": audience or ENV.get("JWT_AUDIENCE", "authenticated"),
        "typ": "device",
        "iat": now,
        "exp": now + ttl_s,
    }
    token = jwt.encode(payload, secret or ENV["JWT_SECRET"], algorithm="HS256")
    return {"device_id": device_id, "token": token, "token_type": "Bearer", "expires_in": ttl_s}


def read_bearer(authorization: str, secret: str | None = None, audience: str | None = None) -> dict:
    if not authorization.startswith("Bearer "):
        raise ValueError("missing bearer token")
    return jwt.decode(
        authorization[7:],
        secret or ENV["JWT_SECRET"],
        algorithms=["HS256"],
        audience=audience or ENV.get("JWT_AUDIENCE", "authenticated"),
    )
