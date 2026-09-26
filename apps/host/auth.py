from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from platform_store import get_user_by_id, platform_dir

ALG = "HS256"
_bearer = HTTPBearer(auto_error=False)


def _sha256(raw: str) -> bytes:
    return hashlib.sha256(raw.encode("utf-8")).digest()


def secret_equal(given: str, expected: str) -> bool:
    """Compare secrets without leaking the length of the expected value."""
    return secrets.compare_digest(_sha256(given), _sha256(expected))


def host_secret() -> str:
    """Create jwt.secret once. O_EXCL plus a re-read avoids split secrets across workers."""
    secret_path = platform_dir() / "jwt.secret"
    existing = _read_secret(secret_path)
    if existing:
        return existing
    secret = secrets.token_urlsafe(48)
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    try:
        fd = os.open(secret_path, flags, 0o600)
    except FileExistsError:
        existing = _read_secret(secret_path)
        if existing:
            return existing
        raise
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(secret)
    os.chmod(secret_path, 0o600)
    return secret


def _read_secret(secret_path) -> str:
    if not secret_path.exists():
        return ""
    try:
        os.chmod(secret_path, 0o600)
    except OSError:
        pass
    return secret_path.read_text(encoding="utf-8").strip()


def mint_token(
    client_id: str,
    *,
    scope: str = "loopback",
    email: str | None = None,
    extra: dict | None = None,
) -> str:
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
    if extra:
        payload.update(extra)
    return jwt.encode(payload, host_secret(), algorithm=ALG)


def mint_user_token(user: dict) -> str:
    row = get_user_by_id(user["id"]) or user
    pca = str(row.get("password_changed_at") or "")
    extra = {"pca": pca} if pca else None
    return mint_token(user["id"], scope="user", email=user["email"], extra=extra)


def mint_admin_token(email: str) -> str:
    return mint_token(f"admin:{email}", scope="admin", email=email)


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
    row = get_user_by_id(str(session.get("sub") or ""))
    if not row:
        raise HTTPException(status_code=401, detail="Profile not found. Create an account.")
    token_pca = str(session.get("pca") or "")
    row_pca = str(row.get("password_changed_at") or "")
    if token_pca != row_pca:
        raise HTTPException(status_code=401, detail="Session expired. Sign in again.")
    return session


async def require_admin(session: dict = Depends(require_session)) -> dict:
    if session.get("scope") != "admin" or not session.get("email"):
        raise HTTPException(status_code=401, detail="Admin sign-in required.")
    email = str(session["email"]).lower()
    if email not in settings.admin_email_set:
        raise HTTPException(status_code=403, detail="Not an admin account.")
    return session
