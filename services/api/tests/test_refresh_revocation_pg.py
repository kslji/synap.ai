"""Refresh-token rotation + revocation against a real Postgres (Phase 0, item 2).

The in-memory MemoryAuth path hides a persistence bug: when a rotated token is
replayed, PostgresAuth revokes the whole token family and then raises AuthError
inside ``async with pool.connection()`` — psycopg_pool rolls that write back
out when the exception leaves the block, so on a real database a reused
token's family is never actually revoked. These tests drive PostgresAuth
itself against the local Postgres the server uses (skipped, loudly, only when
the database is unreachable) and pin the three product behaviors:

- replaying a used refresh token burns the entire family, in the database;
- logout revokes the presented refresh token;
- device removal revokes that device's tokens and blocks further rotation.

Run with: DATABASE_URL set, e.g.
  SURF_TEST_PG_URL=postgresql://surf:surfdev@localhost:5432/surf \
      .venv/bin/python -m pytest tests/test_refresh_revocation_pg.py -v
"""
import hashlib
import os
import uuid
from contextlib import asynccontextmanager

import psycopg
import pytest

from app.auth_store import AuthError, PostgresAuth

PG_URL = os.environ.get("SURF_TEST_PG_URL", "postgresql://surf:surfdev@localhost:5432/surf")


def _pg_reachable() -> bool:
    try:
        with psycopg.connect(PG_URL, connect_timeout=2) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _pg_reachable(),
    reason=f"local Postgres not reachable at {PG_URL!r}: item 2 tests must run on the real database",
)


@asynccontextmanager
async def _fresh_auth():
    """A real pool + a throwaway user/device, cleaned up afterwards."""
    pool = _pool()
    await pool.open()
    auth = PostgresAuth(pool)
    user = await auth.upsert_user(f"item2-{uuid.uuid4()}@example.test")
    device = await auth.activate_device(
        user, {"device_uid": f"dev-{uuid.uuid4()}", "os": "linux", "name": "item2 test"}
    )
    try:
        yield auth, user, device
    finally:
        async with pool.connection() as conn:
            await conn.execute("DELETE FROM auth_refresh_tokens WHERE user_id = %s", (user["id"],))
            await conn.execute("DELETE FROM devices WHERE user_id = %s", (user["id"],))
            await conn.execute("DELETE FROM users WHERE id = %s", (user["id"],))
        await pool.close()


def _pool():
    from psycopg_pool import AsyncConnectionPool
    return AsyncConnectionPool(PG_URL, min_size=1, max_size=2, open=False)


@pytest.mark.asyncio
async def test_reused_refresh_token_burns_the_whole_family_in_the_database():
    async with _fresh_auth() as (auth, user, device):
        raw1, family = await auth.issue_refresh(user["id"], device["id"])
        raw2, _, _ = await auth.rotate_refresh(raw1)  # honest rotation

        with pytest.raises(AuthError) as replay:
            await auth.rotate_refresh(raw1)  # replay of the already-used token
        assert replay.value.status == 401
        assert replay.value.code == "refresh_reused"

        # The replay must burn the family: even the legitimate successor is dead.
        with pytest.raises(AuthError) as successor:
            await auth.rotate_refresh(raw2)
        assert successor.value.status == 401

        # ...and the database itself must show every family token revoked.
        async with auth.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT count(*) FROM auth_refresh_tokens"
                " WHERE family_id = %s AND revoked_at IS NULL",
                (family,),
            )).fetchone()
        assert row[0] == 0, "family revocation did not persist (rolled back with the raise)"


@pytest.mark.asyncio
async def test_logout_revokes_the_refresh_token():
    async with _fresh_auth() as (auth, user, device):
        raw, _ = await auth.issue_refresh(user["id"], device["id"])
        await auth.revoke_refresh(raw)  # what POST /v1/auth/logout does

        with pytest.raises(AuthError) as exc:
            await auth.rotate_refresh(raw)
        assert exc.value.status == 401

        async with auth.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT revoked_at FROM auth_refresh_tokens WHERE token_hash = %s",
                (hashlib.sha256(raw.encode()).digest(),),
            )).fetchone()
        assert row[0] is not None


@pytest.mark.asyncio
async def test_device_removal_revokes_its_tokens_and_blocks_rotation():
    async with _fresh_auth() as (auth, user, device):
        raw, _ = await auth.issue_refresh(user["id"], device["id"])
        assert await auth.revoke_device(user["id"], device["id"]) is True

        with pytest.raises(AuthError) as exc:
            await auth.rotate_refresh(raw)
        assert exc.value.status == 401
        assert not await auth.device_active(device["id"])

        async with auth.pool.connection() as conn:
            row = await (await conn.execute(
                "SELECT count(*) FROM auth_refresh_tokens"
                " WHERE device_id = %s AND revoked_at IS NULL",
                (device["id"],),
            )).fetchone()
        assert row[0] == 0, "device removal must revoke the device's refresh tokens"
