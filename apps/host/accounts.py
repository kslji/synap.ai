from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import HTTPException

from platform_store import (
    consume_otp,
    bump_otp_attempts,
    get_active_otp,
    get_user_by_email,
    get_user_by_id,
    get_user_by_referral_code,
    insert_mail_job,
    insert_otp,
    insert_user,
    now_iso,
    record_event,
    set_user_password,
    set_user_verified,
)
import mail_queue

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
_hasher = PasswordHasher()
OTP_MINUTES = 10
MAX_OTP_TRIES = 5


def normalize_email(raw: str) -> str:
    email = raw.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    return email


def public_user(row: dict) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "email_verified": bool(row["email_verified"]),
        "created_at": row["created_at"],
        "updated_at": row.get("updated_at"),
    }


def hash_secret(value: str) -> str:
    return _hasher.hash(value)


def verify_secret(stored: str, given: str) -> bool:
    try:
        _hasher.verify(stored, given)
        return True
    except VerifyMismatchError:
        return False


def _issue_otp(email: str, purpose: str) -> str:
    code = f"{secrets.randbelow(1_000_000):06d}"
    exp = (datetime.now(timezone.utc) + timedelta(minutes=OTP_MINUTES)).isoformat()
    insert_otp(email, purpose, hash_secret(code), exp)
    if purpose == "verify":
        subject = "Verify your local.ai email"
        body = f"Your local.ai email verification code is {code}. It expires in {OTP_MINUTES} minutes."
    else:
        subject = "Reset your local.ai password"
        body = f"Your local.ai password reset code is {code}. It expires in {OTP_MINUTES} minutes."
    insert_mail_job(email, subject, body, now_iso())
    mail_queue.notify()
    mail_queue.process_due_jobs()
    return code


def register(email: str, password: str, referral_code: str | None = None) -> dict:
    email = normalize_email(email)
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    ref = (referral_code or "").strip().lower()[:32] or None
    if ref and not get_user_by_referral_code(ref):
        # Unknown codes are ignored (still allow signup).
        ref = None
    existing = get_user_by_email(email)
    if existing and existing["email_verified"]:
        raise HTTPException(status_code=409, detail="An account with that email already exists. Sign in.")
    if existing:
        if not verify_secret(existing["password_hash"], password):
            set_user_password(existing["id"], hash_secret(password))
    else:
        try:
            insert_user(email, hash_secret(password), referred_by=ref)
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                raise HTTPException(status_code=409, detail="An account with that email already exists. Sign in.") from exc
            raise
    _issue_otp(email, "verify")
    saved = get_user_by_email(email)
    assert saved
    record_event("signup", email, referral_code=ref)
    return {"ok": True, "needs_verification": True, "email": email, "user": public_user(saved)}


def verify_email(email: str, otp: str) -> dict:
    email = normalize_email(email)
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="Create an account first.")
    _check_otp(email, "verify", otp)
    set_user_verified(user["id"])
    updated = get_user_by_id(user["id"])
    assert updated
    return public_user(updated)


def login(email: str, password: str) -> dict:
    email = normalize_email(email)
    user = get_user_by_email(email)
    if not user or not verify_secret(user["password_hash"], password):
        raise HTTPException(status_code=401, detail="Email or password is wrong.")
    if not user["email_verified"]:
        _issue_otp(email, "verify")
        raise HTTPException(
            status_code=403,
            detail="Verify your email first. Enter the 6-digit code we sent, or request a new one.",
        )
    record_event("login", email, referral_code=user.get("referred_by"))
    return public_user(user)


def forgot(email: str) -> dict:
    email = normalize_email(email)
    user = get_user_by_email(email)
    if user:
        _issue_otp(email, "reset")
    return {"ok": True, "email": email}


def reset_password(email: str, otp: str, password: str) -> dict:
    email = normalize_email(email)
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")
    user = get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=404, detail="No account for that email.")
    _check_otp(email, "reset", otp)
    set_user_password(user["id"], hash_secret(password))
    if not user["email_verified"]:
        set_user_verified(user["id"])
    updated = get_user_by_id(user["id"])
    assert updated
    return public_user(updated)


def resend(email: str, purpose: str) -> dict:
    email = normalize_email(email)
    if purpose not in {"verify", "reset"}:
        raise HTTPException(status_code=400, detail="purpose must be verify or reset")
    user = get_user_by_email(email)
    if purpose == "verify" and not user:
        raise HTTPException(status_code=404, detail="Create an account first.")
    if user or purpose == "reset":
        if user or get_user_by_email(email):
            _issue_otp(email, purpose)
    return {"ok": True}


def _check_otp(email: str, purpose: str, otp: str) -> None:
    row = get_active_otp(email, purpose)
    if not row:
        raise HTTPException(status_code=400, detail="No active OTP. Request a new code.")
    if row["expires_at"] < datetime.now(timezone.utc).isoformat():
        consume_otp(row["id"])
        raise HTTPException(status_code=400, detail="That OTP expired. Request a new code.")
    if int(row["attempts"]) >= MAX_OTP_TRIES:
        consume_otp(row["id"])
        raise HTTPException(status_code=429, detail="Too many OTP tries. Request a new code.")
    if not verify_secret(row["code_hash"], otp.strip()):
        bump_otp_attempts(row["id"])
        raise HTTPException(status_code=400, detail="That OTP is not correct.")
    consume_otp(row["id"])
