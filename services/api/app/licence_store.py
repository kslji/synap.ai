"""Licence rows for lite mode and Postgres.

Lite mode is in memory so pytest needs no database. Production uses the tables
in the Alembic migration and deploy/initdb.
"""
from __future__ import annotations

import uuid
from datetime import datetime

SCHEMA_SQL = """
INSERT INTO plans(code, name, features, offline_grace_days)
VALUES ('pro', 'Pro', '{"max_devices":2,"packs":["general-core"]}', 7)
ON CONFLICT (code) DO NOTHING;
CREATE TABLE IF NOT EXISTS licence_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  key_hint text NOT NULL,
  plan_code text NOT NULL REFERENCES plans(code),
  features jsonb NOT NULL DEFAULT '[]',
  max_devices int NOT NULL DEFAULT 2 CHECK (max_devices > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','refunded')),
  provider text,
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  refunded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licence_provider
  ON licence_keys (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_licence_user ON licence_keys (user_id);
CREATE TABLE IF NOT EXISTS licence_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  licence_id uuid NOT NULL REFERENCES licence_keys(id) ON DELETE CASCADE,
  device_id_hash text NOT NULL,
  name text,
  os text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  deactivated_at timestamptz,
  UNIQUE (licence_id, device_id_hash)
);
"""


def _copy(row: dict) -> dict:
    return dict(row)


class MemoryLicences:
    def __init__(self) -> None:
        self.keys: list[dict] = []
        self.devices: list[dict] = []

    async def ensure_schema(self) -> None:
        return None

    async def insert_key(self, row: dict) -> dict:
        stored = {
            "id": row.get("id") or str(uuid.uuid4()),
            "user_id": row["user_id"],
            "key_hash": row["key_hash"],
            "key_hint": row["key_hint"],
            "plan_code": row["plan_code"],
            "features": list(row.get("features") or []),
            "max_devices": int(row.get("max_devices") or 2),
            "status": row.get("status") or "active",
            "provider": row.get("provider"),
            "provider_ref": row.get("provider_ref"),
            "created_at": row.get("created_at"),
            "revoked_at": None,
            "refunded_at": None,
        }
        self.keys.append(stored)
        return _copy(stored)

    async def by_key_hash(self, key_hash: str) -> dict | None:
        return next((_copy(row) for row in self.keys if row["key_hash"] == key_hash), None)

    async def by_id(self, licence_id: str) -> dict | None:
        return next((_copy(row) for row in self.keys if row["id"] == licence_id), None)

    async def by_provider(self, provider: str, provider_ref: str) -> dict | None:
        return next((_copy(row) for row in self.keys if row.get("provider") == provider and row.get("provider_ref") == provider_ref), None)

    async def active_for_user(self, user_id: str) -> dict | None:
        rows = [row for row in self.keys if row["user_id"] == user_id and row["status"] == "active"]
        return _copy(rows[-1]) if rows else None

    async def latest_for_user(self, user_id: str) -> dict | None:
        rows = [row for row in self.keys if row["user_id"] == user_id]
        return _copy(rows[-1]) if rows else None

    async def licences_for_user(self, user_id: str) -> list[dict]:
        return [_copy(row) for row in self.keys if row["user_id"] == user_id]

    async def set_status(self, licence_id: str, status: str, now: datetime) -> None:
        for row in self.keys:
            if row["id"] != licence_id:
                continue
            row["status"] = status
            if status == "revoked":
                row["revoked_at"] = now
            if status == "refunded":
                row["refunded_at"] = now

    async def active_devices(self, licence_id: str) -> list[dict]:
        return [_copy(row) for row in self.devices if row["licence_id"] == licence_id and not row.get("deactivated_at")]

    async def add_device(self, licence_id: str, device_id_hash: str, name: str, os_name: str, now: datetime) -> dict:
        for row in self.devices:
            if row["licence_id"] == licence_id and row["device_id_hash"] == device_id_hash:
                row["name"] = name
                row["os"] = os_name
                row["last_seen_at"] = now
                row["deactivated_at"] = None
                return _copy(row)
        row = {
            "id": str(uuid.uuid4()),
            "licence_id": licence_id,
            "device_id_hash": device_id_hash,
            "name": name,
            "os": os_name,
            "activated_at": now,
            "last_seen_at": now,
            "deactivated_at": None,
        }
        self.devices.append(row)
        return _copy(row)

    async def touch(self, device_row_id: str, now: datetime) -> None:
        for row in self.devices:
            if row["id"] == device_row_id:
                row["last_seen_at"] = now

    async def device_by_id(self, device_row_id: str) -> dict | None:
        return next((_copy(row) for row in self.devices if row["id"] == device_row_id), None)

    async def device_by_hash(self, licence_id: str, device_id_hash: str) -> dict | None:
        return next((_copy(row) for row in self.devices if row["licence_id"] == licence_id and row["device_id_hash"] == device_id_hash), None)

    async def deactivate(self, device_row_id: str, now: datetime) -> None:
        for row in self.devices:
            if row["id"] == device_row_id:
                row["deactivated_at"] = now


def _key_row(row) -> dict:
    features = row[5]
    if isinstance(features, str):
        import json
        features = json.loads(features)
    return {
        "id": row[0],
        "user_id": row[1],
        "key_hash": row[2],
        "key_hint": row[3],
        "plan_code": row[4],
        "features": list(features or []),
        "max_devices": int(row[6]),
        "status": row[7],
        "provider": row[8],
        "provider_ref": row[9],
        "created_at": row[10],
        "revoked_at": row[11],
        "refunded_at": row[12],
    }


def _device_row(row) -> dict:
    return {
        "id": row[0],
        "licence_id": row[1],
        "device_id_hash": row[2],
        "name": row[3],
        "os": row[4],
        "activated_at": row[5],
        "last_seen_at": row[6],
        "deactivated_at": row[7],
    }


_KEY_COLS = """id::text, user_id::text, key_hash, key_hint, plan_code, features, max_devices, status,
provider, provider_ref, created_at, revoked_at, refunded_at"""
_DEVICE_COLS = "id::text, licence_id::text, device_id_hash, name, os, activated_at, last_seen_at, deactivated_at"


class PostgresLicences:
    def __init__(self, pool) -> None:
        self.pool = pool

    async def ensure_schema(self) -> None:
        async with self.pool.connection() as conn:
            await conn.execute(SCHEMA_SQL)

    async def insert_key(self, row: dict) -> dict:
        import json
        async with self.pool.connection() as conn:
            created = await (await conn.execute(
                f"""INSERT INTO licence_keys
                    (user_id, key_hash, key_hint, plan_code, features, max_devices, status, provider, provider_ref, created_at)
                    VALUES (%s, %s, %s, %s, %s::jsonb, %s, 'active', %s, %s, %s)
                    RETURNING {_KEY_COLS}""",
                (
                    row["user_id"], row["key_hash"], row["key_hint"], row["plan_code"],
                    json.dumps(list(row.get("features") or [])), int(row.get("max_devices") or 2),
                    row.get("provider"), row.get("provider_ref"), row.get("created_at"),
                ),
            )).fetchone()
        return _key_row(created)

    async def by_key_hash(self, key_hash: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"SELECT {_KEY_COLS} FROM licence_keys WHERE key_hash = %s",
                (key_hash,),
            )).fetchone()
        return _key_row(row) if row else None

    async def by_id(self, licence_id: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"SELECT {_KEY_COLS} FROM licence_keys WHERE id = %s",
                (licence_id,),
            )).fetchone()
        return _key_row(row) if row else None

    async def by_provider(self, provider: str, provider_ref: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"SELECT {_KEY_COLS} FROM licence_keys WHERE provider = %s AND provider_ref = %s",
                (provider, provider_ref),
            )).fetchone()
        return _key_row(row) if row else None

    async def active_for_user(self, user_id: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"""SELECT {_KEY_COLS} FROM licence_keys
                    WHERE user_id = %s AND status = 'active' ORDER BY created_at DESC LIMIT 1""",
                (user_id,),
            )).fetchone()
        return _key_row(row) if row else None

    async def latest_for_user(self, user_id: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"SELECT {_KEY_COLS} FROM licence_keys WHERE user_id = %s ORDER BY created_at DESC LIMIT 1",
                (user_id,),
            )).fetchone()
        return _key_row(row) if row else None

    async def licences_for_user(self, user_id: str) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                f"SELECT {_KEY_COLS} FROM licence_keys WHERE user_id = %s",
                (user_id,),
            )).fetchall()
        return [_key_row(row) for row in rows]

    async def set_status(self, licence_id: str, status: str, now: datetime) -> None:
        column = "revoked_at" if status == "revoked" else "refunded_at" if status == "refunded" else None
        async with self.pool.connection() as conn:
            if column:
                await conn.execute(
                    f"UPDATE licence_keys SET status = %s, {column} = %s WHERE id = %s",
                    (status, now, licence_id),
                )
            else:
                await conn.execute("UPDATE licence_keys SET status = %s WHERE id = %s", (status, licence_id))

    async def active_devices(self, licence_id: str) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute(
                f"SELECT {_DEVICE_COLS} FROM licence_devices WHERE licence_id = %s AND deactivated_at IS NULL ORDER BY activated_at",
                (licence_id,),
            )).fetchall()
        return [_device_row(row) for row in rows]

    async def add_device(self, licence_id: str, device_id_hash: str, name: str, os_name: str, now: datetime) -> dict:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"""INSERT INTO licence_devices (licence_id, device_id_hash, name, os, activated_at, last_seen_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (licence_id, device_id_hash) DO UPDATE
                      SET deactivated_at = NULL, last_seen_at = EXCLUDED.last_seen_at, name = EXCLUDED.name
                    RETURNING {_DEVICE_COLS}""",
                (licence_id, device_id_hash, name, os_name, now, now),
            )).fetchone()
        return _device_row(row)

    async def touch(self, device_row_id: str, now: datetime) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE licence_devices SET last_seen_at = %s WHERE id = %s", (now, device_row_id))

    async def device_by_id(self, device_row_id: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"SELECT {_DEVICE_COLS} FROM licence_devices WHERE id = %s",
                (device_row_id,),
            )).fetchone()
        return _device_row(row) if row else None

    async def device_by_hash(self, licence_id: str, device_id_hash: str) -> dict | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute(
                f"SELECT {_DEVICE_COLS} FROM licence_devices WHERE licence_id = %s AND device_id_hash = %s",
                (licence_id, device_id_hash),
            )).fetchone()
        return _device_row(row) if row else None

    async def deactivate(self, device_row_id: str, now: datetime) -> None:
        async with self.pool.connection() as conn:
            await conn.execute("UPDATE licence_devices SET deactivated_at = %s WHERE id = %s", (now, device_row_id))
