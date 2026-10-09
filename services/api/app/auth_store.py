"""Users, OTP challenges, devices, and rotating refresh tokens.

Lite mode keeps this in memory so tests and the desktop self-test need no Postgres.
Production uses the tables in deploy/initdb plus the otp migration.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from .otp_policy import (
    MAX_OTP_TRIES,
    OTP_MINUTES,
    cooldown_left,
    hash_code,
    judge_otp,
    normalize_code,
    normalize_email,
)

ENV = os.environ
REFRESH_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def hash_refresh(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class AuthError(Exception):
    def __init__(self, status: int, code: str, detail: str, retry_after: int | None = None):
        self.status, self.code, self.detail, self.retry_after = status, code, detail, retry_after


class MemoryAuth:
    def __init__(self) -> None:
        self.users: dict[str, dict] = {}
        self.otps: list[dict] = []
        self.devices: list[dict] = []
        self.refresh: list[dict] = []
        self.limit = int(ENV.get("MAX_DEVICES", "3"))

    async def ensure_schema(self) -> None:
        return None

    def _user(self, email: str) -> dict | None:
        return self.users.get(email)

    async def request_code(self, email: str, now: datetime | None = None) -> str:
        now = now or _now()
        email = normalize_email(email)
        recent = [row for row in self.otps if row["email"] == email and not row["consumed"]]
        if recent:
            left = cooldown_left(recent[-1]["created_at"], now)
            if left:
                raise AuthError(429, "resend_cooldown", "Wait before requesting another code.", left)
        user = self._user(email)
        if user is None:
            user = {"id": str(uuid.uuid4()), "email": email, "plan_code": "free", "created_at": now}
            self.users[email] = user
        for row in self.otps:
            if row["email"] == email and not row["consumed"]:
                row["consumed"] = True
        code = f"{secrets.randbelow(1_000_000):06d}"
        self.otps.append({
            "id": str(uuid.uuid4()),
            "email": email,
            "code_hash": hash_code(code),
            "expires_at": now + timedelta(minutes=OTP_MINUTES),
            "attempts": 0,
            "consumed": False,
            "created_at": now,
        })
        return code

    def _active_otp(self, email: str) -> dict | None:
        rows = [row for row in self.otps if row["email"] == email and not row["consumed"]]
        return rows[-1] if rows else None

    async def verify_code(self, email: str, code: str, now: datetime | None = None) -> dict:
        now = now or _now()
        email = normalize_email(email)
        if not __import__("re").fullmatch(r"\d{6}", normalize_code(code)):
            raise AuthError(400, "invalid_code", "Enter the 6-digit code from your email.")
        row = self._active_otp(email)
        verdict = judge_otp(row, code, now, MAX_OTP_TRIES)
        if verdict == "missing":
            raise AuthError(400, "invalid_code", "That code is not valid. Request a new one.")
        if verdict == "expired":
            row["consumed"] = True
            raise AuthError(400, "expired", "That code expired. Request a new one.")
        if verdict == "locked":
            row["attempts"] = MAX_OTP_TRIES
            row["consumed"] = True
            raise AuthError(429, "too_many_attempts", "Too many tries. Request a new code.")
        if verdict == "wrong":
            row["attempts"] = int(row["attempts"]) + 1
            raise AuthError(400, "invalid_code", "That code is not valid. Request a new one.")
        if row["attempts"] >= MAX_OTP_TRIES or row["consumed"]:
            raise AuthError(400, "invalid_code", "That code is not valid. Request a new one.")
        row["consumed"] = True
        user = self.users[email]
        return user

    async def activate_device(self, user: dict, device: dict, now: datetime | None = None) -> dict:
        now = now or _now()
        uid = (device.get("device_uid") or "").strip() or str(uuid.uuid4())
        os_name = device.get("os") or "linux"
        if os_name not in {"macos", "windows", "linux"}:
            raise AuthError(400, "invalid_device", "os must be macos, windows, or linux.")
        existing = next((row for row in self.devices if row["user_id"] == user["id"] and row["device_uid"] == uid), None)
        if existing:
            if existing["status"] != "active":
                raise AuthError(403, "device_revoked", "This device was revoked. Remove it from the account or use another computer.")
            existing["last_seen_at"] = now
            existing["name"] = device.get("name") or existing["name"]
            return existing
        active = [row for row in self.devices if row["user_id"] == user["id"] and row["status"] == "active"]
        if len(active) >= self.limit:
            raise AuthError(403, "device_limit", f"This plan allows {self.limit} devices. Revoke one to continue.")
        row = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "device_uid": uid,
            "name": (device.get("name") or "Surf")[:80],
            "os": os_name,
            "arch": (device.get("arch") or "x64")[:32],
            "app_version": (device.get("app_version") or "0.1.0")[:32],
            "status": "active",
            "created_at": now,
            "last_seen_at": now,
        }
        self.devices.append(row)
        return row

    async def list_devices(self, user_id: str) -> list[dict]:
        return [row for row in self.devices if row["user_id"] == user_id]

    async def revoke_device(self, user_id: str, device_id: str) -> bool:
        for row in self.devices:
            if row["user_id"] == user_id and row["id"] == device_id and row["status"] == "active":
                row["status"] = "revoked"
                for token in self.refresh:
                    if token["device_id"] == device_id:
                        token["revoked"] = True
                return True
        return False

    async def device_active(self, device_id: str) -> bool:
        return any(row["id"] == device_id and row["status"] == "active" for row in self.devices)

    async def user_by_id(self, user_id: str) -> dict | None:
        return next((row for row in self.users.values() if row["id"] == user_id), None)

    async def issue_refresh(self, user_id: str, device_id: str, family_id: str | None = None, now: datetime | None = None) -> tuple[str, str]:
        now = now or _now()
        raw = secrets.token_urlsafe(32)
        family = family_id or str(uuid.uuid4())
        self.refresh.append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "device_id": device_id,
            "token_hash": hash_refresh(raw),
            "family_id": family,
            "expires_at": now + timedelta(days=REFRESH_DAYS),
            "revoked": False,
            "replaced_by": None,
        })
        return raw, family

    async def rotate_refresh(self, raw: str, now: datetime | None = None) -> tuple[str, dict, dict]:
        now = now or _now()
        row = next((item for item in self.refresh if item["token_hash"] == hash_refresh(raw)), None)
        if row is None:
            raise AuthError(401, "invalid_refresh", "Sign in again.")
        if row["revoked"] or row["replaced_by"]:
            for item in self.refresh:
                if item["family_id"] == row["family_id"]:
                    item["revoked"] = True
            raise AuthError(401, "refresh_reused", "That session was already used. Sign in again.")
        if row["expires_at"] <= now:
            row["revoked"] = True
            raise AuthError(401, "invalid_refresh", "Sign in again.")
        device = next((item for item in self.devices if item["id"] == row["device_id"]), None)
        user = await self.user_by_id(row["user_id"])
        if not device or device["status"] != "active" or not user:
            row["revoked"] = True
            raise AuthError(401, "device_revoked", "This device was revoked.")
        new_raw, _family = await self.issue_refresh(user["id"], device["id"], row["family_id"], now)
        row["revoked"] = True
        row["replaced_by"] = self.refresh[-1]["id"]
        return new_raw, user, device

    async def revoke_refresh(self, raw: str) -> None:
        row = next((item for item in self.refresh if item["token_hash"] == hash_refresh(raw)), None)
        if row:
            row["revoked"] = True


class PostgresAuth(MemoryAuth):
    """Same methods, Postgres tables. ensure_schema adds the OTP table on databases created before it."""

    def __init__(self, pool) -> None:
        super().__init__()
        self.pool = pool

    async def ensure_schema(self) -> None:
        sql = """
        CREATE TABLE IF NOT EXISTS otp_challenges (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email citext NOT NULL,
          purpose text NOT NULL DEFAULT 'login',
          code_hash text NOT NULL,
          expires_at timestamptz NOT NULL,
          attempts int NOT NULL DEFAULT 0,
          consumed boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_challenges (email, created_at DESC);
        """
        async with self.pool.connection() as conn:
            await conn.execute(sql)
            await conn.execute("ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()")

    async def request_code(self, email: str, now: datetime | None = None) -> str:
        now = now or _now()
        email = normalize_email(email)
        async with self.pool.connection() as conn:
            recent = await (await conn.execute(
                "SELECT created_at FROM otp_challenges WHERE email = %s AND consumed = false ORDER BY created_at DESC LIMIT 1",
                (email,),
            )).fetchone()
            if recent:
                left = cooldown_left(recent[0], now)
                if left:
                    raise AuthError(429, "resend_cooldown", "Wait before requesting another code.", left)
            user = await (await conn.execute("SELECT id, email, plan_code FROM users WHERE email = %s AND deleted_at IS NULL", (email,))).fetchone()
            if user is None:
                user = await (await conn.execute(
                    "INSERT INTO users (id, email, plan_code) VALUES (gen_random_uuid(), %s, 'free') RETURNING id, email, plan_code",
                    (email,),
                )).fetchone()
            await conn.execute("UPDATE otp_challenges SET consumed = true WHERE email = %s AND consumed = false", (email,))
            code = f"{secrets.randbelow(1_000_000):06d}"
            await conn.execute(
                "INSERT INTO otp_challenges (email, purpose, code_hash, expires_at, created_at) VALUES (%s, 'login', %s, %s, %s)",
                (email, hash_code(code), now + timedelta(minutes=OTP_MINUTES), now),
            )
        return code

    async def verify_code(self, email: str, code: str, now: datetime | None = None) -> dict:
        now = now or _now()
        email = normalize_email(email)
        if not __import__("re").fullmatch(r"\d{6}", normalize_code(code)):
            raise AuthError(400, "invalid_code", "Enter the 6-digit code from your email.")
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                """SELECT id, code_hash, expires_at, attempts FROM otp_challenges
                   WHERE email = %s AND consumed = false ORDER BY created_at DESC LIMIT 1""",
                (email,),
            )).fetchone()
            packed = None if row is None else {"code_hash": row[1], "expires_at": row[2], "attempts": row[3]}
            verdict = judge_otp(packed, code, now, MAX_OTP_TRIES)
            if verdict == "missing":
                raise AuthError(400, "invalid_code", "That code is not valid. Request a new one.")
            if verdict in {"expired", "locked"}:
                await conn.execute("UPDATE otp_challenges SET consumed = true, attempts = %s WHERE id = %s", (MAX_OTP_TRIES, row[0]))
                if verdict == "expired":
                    raise AuthError(400, "expired", "That code expired. Request a new one.")
                raise AuthError(429, "too_many_attempts", "Too many tries. Request a new code.")
            if verdict == "wrong":
                await conn.execute("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = %s", (row[0],))
                raise AuthError(400, "invalid_code", "That code is not valid. Request a new one.")
            updated = await conn.execute(
                "UPDATE otp_challenges SET consumed = true WHERE id = %s AND consumed = false AND attempts < %s",
                (row[0], MAX_OTP_TRIES),
            )
            if updated.rowcount != 1:
                raise AuthError(400, "invalid_code", "That code is not valid. Request a new one.")
            user = await (await conn.execute(
                "SELECT id::text, email::text, plan_code FROM users WHERE email = %s",
                (email,),
            )).fetchone()
        return {"id": user[0], "email": user[1], "plan_code": user[2]}

    async def _limit_for(self, conn, user_id: str) -> int:
        row = await (await conn.execute(
            """SELECT COALESCE((features->>'max_devices')::int, %s)
               FROM users u JOIN plans p ON p.code = u.plan_code WHERE u.id = %s""",
            (self.limit, user_id),
        )).fetchone()
        return int(row[0]) if row else self.limit

    async def activate_device(self, user: dict, device: dict, now: datetime | None = None) -> dict:
        now = now or _now()
        uid = (device.get("device_uid") or "").strip() or str(uuid.uuid4())
        os_name = device.get("os") or "linux"
        if os_name not in {"macos", "windows", "linux"}:
            raise AuthError(400, "invalid_device", "os must be macos, windows, or linux.")
        async with self.pool.connection() as conn:
            existing = await (await conn.execute(
                """SELECT id::text, user_id::text, device_uid, name, os, arch, app_version, status
                   FROM devices WHERE user_id = %s AND device_uid = %s""",
                (user["id"], uid),
            )).fetchone()
            if existing:
                if existing[7] != "active":
                    raise AuthError(403, "device_revoked", "This device was revoked. Remove it from the account or use another computer.")
                await conn.execute("UPDATE devices SET last_seen_at = %s, name = %s WHERE id = %s", (now, device.get("name") or existing[3], existing[0]))
                return _device_row(existing)
            limit = await self._limit_for(conn, user["id"])
            count = await (await conn.execute(
                "SELECT count(*) FROM devices WHERE user_id = %s AND status = 'active'",
                (user["id"],),
            )).fetchone()
            if int(count[0]) >= limit:
                raise AuthError(403, "device_limit", f"This plan allows {limit} devices. Revoke one to continue.")
            created = await (await conn.execute(
                """INSERT INTO devices (user_id, device_uid, name, os, arch, app_version, status, last_seen_at)
                   VALUES (%s, %s, %s, %s, %s, %s, 'active', %s)
                   RETURNING id::text, user_id::text, device_uid, name, os, arch, app_version, status""",
                (user["id"], uid, (device.get("name") or "Surf")[:80], os_name, (device.get("arch") or "x64")[:32], (device.get("app_version") or "0.1.0")[:32], now),
            )).fetchone()
        return _device_row(created)

    async def list_devices(self, user_id: str) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                """SELECT id::text, user_id::text, device_uid, name, os, arch, app_version, status
                   FROM devices WHERE user_id = %s ORDER BY created_at""",
                (user_id,),
            )).fetchall()
        return [_device_row(row) for row in rows]

    async def revoke_device(self, user_id: str, device_id: str) -> bool:
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE devices SET status = 'revoked' WHERE id = %s AND user_id = %s AND status = 'active'",
                (device_id, user_id),
            )
            if cur.rowcount != 1:
                return False
            await conn.execute("UPDATE auth_refresh_tokens SET revoked_at = now() WHERE device_id = %s AND revoked_at IS NULL", (device_id,))
        return True

    async def device_active(self, device_id: str) -> bool:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT status FROM devices WHERE id = %s",
                (device_id,),
            )).fetchone()
        return bool(row and row[0] == "active")

    async def user_by_id(self, user_id: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT id::text, email::text, plan_code FROM users WHERE id = %s",
                (user_id,),
            )).fetchone()
        if not row:
            return None
        return {"id": row[0], "email": row[1], "plan_code": row[2]}

    async def issue_refresh(self, user_id: str, device_id: str, family_id: str | None = None, now: datetime | None = None) -> tuple[str, str]:
        now = now or _now()
        raw = secrets.token_urlsafe(32)
        family = family_id or str(uuid.uuid4())
        async with self.pool.connection() as conn:
            await conn.execute(
                """INSERT INTO auth_refresh_tokens (user_id, device_id, token_hash, family_id, expires_at)
                   VALUES (%s, %s, %s, %s, %s)""",
                (user_id, device_id, hashlib.sha256(raw.encode()).digest(), family, now + timedelta(days=REFRESH_DAYS)),
            )
        return raw, family

    async def rotate_refresh(self, raw: str, now: datetime | None = None) -> tuple[str, dict, dict]:
        now = now or _now()
        digest = hashlib.sha256(raw.encode()).digest()
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                """SELECT id::text, user_id::text, device_id::text, family_id::text, expires_at, revoked_at, replaced_by::text
                   FROM auth_refresh_tokens WHERE token_hash = %s""",
                (digest,),
            )).fetchone()
            if row is None:
                raise AuthError(401, "invalid_refresh", "Sign in again.")
            if row[5] is not None or row[6] is not None:
                await conn.execute("UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family_id = %s", (row[3],))
                raise AuthError(401, "refresh_reused", "That session was already used. Sign in again.")
            if row[4] <= now:
                await conn.execute("UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = %s", (row[0],))
                raise AuthError(401, "invalid_refresh", "Sign in again.")
            device = await (await conn.execute(
                """SELECT id::text, user_id::text, device_uid, name, os, arch, app_version, status
                   FROM devices WHERE id = %s""",
                (row[2],),
            )).fetchone()
            user = await self.user_by_id(row[1])
            if not device or device[7] != "active" or not user:
                await conn.execute("UPDATE auth_refresh_tokens SET revoked_at = now() WHERE id = %s", (row[0],))
                raise AuthError(401, "device_revoked", "This device was revoked.")
            new_raw = secrets.token_urlsafe(32)
            inserted = await (await conn.execute(
                """INSERT INTO auth_refresh_tokens (user_id, device_id, token_hash, family_id, expires_at)
                   VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                (user["id"], device[0], hashlib.sha256(new_raw.encode()).digest(), row[3], now + timedelta(days=REFRESH_DAYS)),
            )).fetchone()
            await conn.execute(
                "UPDATE auth_refresh_tokens SET revoked_at = now(), replaced_by = %s WHERE id = %s AND revoked_at IS NULL",
                (inserted[0], row[0]),
            )
        return new_raw, user, _device_row(device)

    async def revoke_refresh(self, raw: str) -> None:
        digest = hashlib.sha256(raw.encode()).digest()
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE auth_refresh_tokens SET revoked_at = now() WHERE token_hash = %s", (digest,))


def _device_row(row) -> dict:
    return {
        "id": row[0], "user_id": row[1], "device_uid": row[2], "name": row[3],
        "os": row[4], "arch": row[5], "app_version": row[6], "status": row[7],
    }
