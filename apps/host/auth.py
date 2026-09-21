from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from platform_store import platform_dir

ALG = "HS256"
_bearer = HTTPBearer(auto_error=False)


def host_secret() -> str:
    secret_path = platform_dir() / "jwt.secret"
    if secret_path.exists():
        return secret_path.read_text(encoding="utf-8").strip()
    secret = secrets.token_urlsafe(48)
    secret_path.write_text(secret, encoding="utf-8")
    secret_path.chmod(0o600)
    return secret


def mint_token(client_id: str, *, scope: str = "loopback", email: str | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": client_id,
        "aud": "local-ai",
        "iss": "small-cloud-host",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.jwt_ttl_hours)).timestamp()),
        "scope": scope,
    }
    if email:
        payload["email"] = email
    return jwt.encode(payload, host_secret(), algorithm=ALG)


def mint_user_token(user: dict) -> str:
    return mint_token(user["id"], scope="user", email=user["email"])


def mint_admin_token(email: str) -> str:
    return mint_token(f"admin:{email}", scope="admin", email=email)


async def require_admin(session: dict = Depends(require_session)) -> dict:
    if session.get("scope") != "admin" or not session.get("email"):
        raise HTTPException(status_code=401, detail="Admin sign-in required.")
    email = str(session["email"]).lower()
    if email not in settings.admin_email_set:
        raise HTTPException(status_code=403, detail="Not an admin account.")
    return session


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            host_secret(),
            algorithms=[ALG],
            audience="local-ai",
            issuer="small-cloud-host",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid local session token") from exc


async def require_session(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return decode_token(creds.credentials)


async def require_user(session: dict = Depends(require_session)) -> dict:
    if session.get("scope") != "user" or not session.get("email"):
        raise HTTPException(status_code=401, detail="Sign in with your email profile.")
    return session
