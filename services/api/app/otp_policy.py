"""OTP rules shared with apps/host.

The host in apps/host is the owner's login service (argon2, five tries, one-time
consume). This module is that policy with no database and no HTTP types, so the
desktop API can apply the same checks. The host calls these functions too.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
OTP_RE = re.compile(r"^\d{6}$")
OTP_MINUTES = 10
MAX_OTP_TRIES = 5
RESEND_COOLDOWN_S = 60
_hasher = PasswordHasher()


def hash_code(code: str) -> str:
    return _hasher.hash(code)


def verify_code(stored: str, given: str) -> bool:
    try:
        _hasher.verify(stored, given)
        return True
    except VerifyMismatchError:
        return False


def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise ValueError("invalid email")
    return email


def normalize_code(raw: str) -> str:
    return re.sub(r"\s+", "", raw or "")


def as_utc(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    parsed = datetime.fromisoformat(str(value))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def cooldown_left(created_at: datetime | str, now: datetime) -> int:
    age = (now - as_utc(created_at)).total_seconds()
    left = int(RESEND_COOLDOWN_S - age)
    return left if left > 0 else 0


def judge_otp(row: dict | None, code: str, now: datetime, max_tries: int = MAX_OTP_TRIES) -> str:
    """missing, expired, locked, wrong, ok. Does not write. A wrong guess that reaches the cap is locked."""
    if row is None:
        return "missing"
    if as_utc(row["expires_at"]) <= now:
        return "expired"
    attempts = int(row.get("attempts") or 0)
    if attempts >= max_tries:
        return "locked"
    if not verify_code(str(row["code_hash"]), normalize_code(code)):
        if attempts + 1 >= max_tries:
            return "locked"
        return "wrong"
    return "ok"
