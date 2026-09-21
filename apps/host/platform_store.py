"""Operator-owned SQLite: accounts, OTP, mail jobs, thumbs feedback.

This file is NOT the user's instance folder. Chats stay in instance smallcloud.db
or in the browser. Auth + feedback live here (the host you run as “our backend”).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import ROOT, settings


def platform_dir() -> Path:
    if settings.platform_data_dir:
        path = Path(settings.platform_data_dir).expanduser().resolve()
    else:
        path = ROOT / "data" / "platform"
    path.mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return platform_dir() / "platform.db"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_platform_db() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              email_verified INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS otp_challenges (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL,
              purpose TEXT NOT NULL,
              code_hash TEXT NOT NULL,
              expires_at TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              consumed INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS mail_jobs (
              id TEXT PRIMARY KEY,
              to_email TEXT NOT NULL,
              subject TEXT NOT NULL,
              body TEXT NOT NULL,
              status TEXT NOT NULL,
              attempts INTEGER NOT NULL DEFAULT 0,
              available_at TEXT NOT NULL,
              last_error TEXT,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS feedback (
              id TEXT PRIMARY KEY,
              rating TEXT NOT NULL,
              title TEXT NOT NULL,
              message TEXT NOT NULL,
              conversation_id TEXT,
              client_id TEXT NOT NULL,
              engine TEXT,
              flags TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS analytics_events (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              label TEXT NOT NULL,
              referral_code TEXT,
              meta TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_analytics_kind
              ON analytics_events(kind, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_analytics_label
              ON analytics_events(kind, label);
            """
        )
        _ensure_user_referral_columns(conn)
    _migrate_from_instance_if_needed()


def _ensure_user_referral_columns(conn: sqlite3.Connection) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
    if "referral_code" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN referral_code TEXT")
    if "referred_by" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN referred_by TEXT")
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)"
    )

def _migrate_from_instance_if_needed() -> None:
    """One-time copy if an older instance DB still holds users/feedback."""
    from instances import current_dir

    root = current_dir()
    if root is None:
        return
    src = root / "smallcloud.db"
    if not src.exists():
        return
    marker = platform_dir() / ".migrated-from-instance"
    if marker.exists():
        return
    try:
        with sqlite3.connect(src) as old, _connect() as new:
            old.row_factory = sqlite3.Row
            for table in ("users", "otp_challenges", "mail_jobs", "feedback"):
                try:
                    rows = old.execute(f"SELECT * FROM {table}").fetchall()
                except sqlite3.OperationalError:
                    continue
                for row in rows:
                    keys = row.keys()
                    placeholders = ",".join("?" * len(keys))
                    cols = ",".join(keys)
                    try:
                        new.execute(
                            f"INSERT OR IGNORE INTO {table} ({cols}) VALUES ({placeholders})",
                            [row[k] for k in keys],
                        )
                    except sqlite3.OperationalError:
                        continue
        marker.write_text("ok\n", encoding="utf-8")
    except sqlite3.Error:
        return


def counts() -> dict:
    init_platform_db()
    with _connect() as conn:
        users = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        fb = conn.execute("SELECT COUNT(*) AS n FROM feedback").fetchone()["n"]
    return {"users": int(users), "feedback": int(fb)}


def purge_ephemeral(max_age_hours: int = 24) -> dict:
    """Drop platform ephemera older than max_age_hours. Never stores chats here.

    Removes: expired/consumed OTPs, finished mail jobs, unverified accounts with no
    recent update, and old feedback rows. Verified accounts are kept.
    """
    init_platform_db()
    cutoff = datetime.now(timezone.utc).timestamp() - max(1, max_age_hours) * 3600
    cutoff_iso = datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat()
    removed = {"otp": 0, "mail": 0, "unverified_users": 0, "feedback": 0}
    with _connect() as conn:
        cur = conn.execute(
            """
            DELETE FROM otp_challenges
            WHERE consumed = 1 OR expires_at < ? OR created_at < ?
            """,
            (now_iso(), cutoff_iso),
        )
        removed["otp"] = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        cur = conn.execute(
            """
            DELETE FROM mail_jobs
            WHERE status IN ('sent', 'dead') AND created_at < ?
            """,
            (cutoff_iso,),
        )
        removed["mail"] = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        cur = conn.execute(
            """
            DELETE FROM users
            WHERE email_verified = 0 AND updated_at < ? AND created_at < ?
            """,
            (cutoff_iso, cutoff_iso),
        )
        removed["unverified_users"] = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
        cur = conn.execute(
            "DELETE FROM feedback WHERE created_at < ?",
            (cutoff_iso,),
        )
        removed["feedback"] = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    return {"ok": True, "cutoff": cutoff_iso, "removed": removed}


def get_user_by_email(email: str) -> dict | None:
    init_platform_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: str) -> dict | None:
    init_platform_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def insert_user(email: str, password_hash: str, referred_by: str | None = None) -> dict:
    init_platform_db()
    uid = str(uuid.uuid4())
    ts = now_iso()
    code = _unique_referral_code()
    ref = (referred_by or "").strip().lower()[:32] or None
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO users (
              id, email, password_hash, email_verified, created_at, updated_at,
              referral_code, referred_by
            )
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (uid, email, password_hash, 0, ts, ts, code.lower(), ref),
        )
    return {
        "id": uid,
        "email": email,
        "email_verified": False,
        "created_at": ts,
        "updated_at": ts,
        "referral_code": code,
        "referred_by": ref,
    }


def _unique_referral_code() -> str:
    for _ in range(12):
        code = uuid.uuid4().hex[:8]
        with _connect() as conn:
            hit = conn.execute(
                "SELECT 1 FROM users WHERE referral_code = ?", (code,)
            ).fetchone()
        if not hit:
            return code
    return uuid.uuid4().hex[:10]


def ensure_user_referral_code(user_id: str) -> str:
    init_platform_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT referral_code FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row and row["referral_code"]:
            return str(row["referral_code"])
        code = _unique_referral_code()
        conn.execute(
            "UPDATE users SET referral_code = ?, updated_at = ? WHERE id = ?",
            (code, now_iso(), user_id),
        )
        return code


def get_user_by_referral_code(code: str) -> dict | None:
    init_platform_db()
    c = (code or "").strip().lower()
    if not c:
        return None
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE lower(referral_code) = ?", (c,)
        ).fetchone()
    return dict(row) if row else None


def record_event(kind: str, label: str, referral_code: str | None = None, meta: dict | None = None) -> None:
    init_platform_db()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO analytics_events (id, kind, label, referral_code, meta, created_at)
            VALUES (?,?,?,?,?,?)
            """,
            (
                str(uuid.uuid4()),
                kind[:64],
                label[:120],
                (referral_code or "").strip().lower()[:32] or None,
                json.dumps(meta or {}),
                now_iso(),
            ),
        )


def admin_stats() -> dict:
    init_platform_db()
    with _connect() as conn:
        total_users = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        verified = conn.execute(
            "SELECT COUNT(*) AS n FROM users WHERE email_verified = 1"
        ).fetchone()["n"]
        logins = conn.execute(
            "SELECT COUNT(*) AS n FROM analytics_events WHERE kind = 'login'"
        ).fetchone()["n"]
        signups = conn.execute(
            "SELECT COUNT(*) AS n FROM analytics_events WHERE kind = 'signup'"
        ).fetchone()["n"]
        model_rows = conn.execute(
            """
            SELECT label, COUNT(*) AS clicks
            FROM analytics_events
            WHERE kind = 'model_click'
            GROUP BY label
            ORDER BY clicks DESC
            LIMIT 40
            """
        ).fetchall()
        agent_rows = conn.execute(
            """
            SELECT label, COUNT(*) AS clicks
            FROM analytics_events
            WHERE kind = 'agent_click'
            GROUP BY label
            ORDER BY clicks DESC
            LIMIT 20
            """
        ).fetchall()
        download_rows = conn.execute(
            """
            SELECT label, COUNT(*) AS clicks
            FROM analytics_events
            WHERE kind = 'download'
            GROUP BY label
            ORDER BY clicks DESC
            LIMIT 40
            """
        ).fetchall()
        referral_rows = conn.execute(
            """
            SELECT referred_by AS code, COUNT(*) AS users
            FROM users
            WHERE referred_by IS NOT NULL AND referred_by != ''
            GROUP BY referred_by
            ORDER BY users DESC
            LIMIT 40
            """
        ).fetchall()
        recent = conn.execute(
            """
            SELECT email, email_verified, created_at, referred_by, referral_code
            FROM users
            ORDER BY created_at DESC
            LIMIT 50
            """
        ).fetchall()
    return {
        "totals": {
            "users": int(total_users),
            "verified": int(verified),
            "logins": int(logins),
            "signups": int(signups),
        },
        "models": [{"label": r["label"], "clicks": int(r["clicks"])} for r in model_rows],
        "agents": [{"label": r["label"], "clicks": int(r["clicks"])} for r in agent_rows],
        "downloads": [{"label": r["label"], "clicks": int(r["clicks"])} for r in download_rows],
        "referrals": [{"code": r["code"], "users": int(r["users"])} for r in referral_rows],
        "recent_users": [
            {
                "email": r["email"],
                "email_verified": bool(r["email_verified"]),
                "created_at": r["created_at"],
                "referred_by": r["referred_by"],
                "referral_code": r["referral_code"],
            }
            for r in recent
        ],
    }


def set_user_verified(user_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?",
            (now_iso(), user_id),
        )


def set_user_password(user_id: str, password_hash: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
            (password_hash, now_iso(), user_id),
        )


def insert_otp(email: str, purpose: str, code_hash: str, expires_at: str) -> str:
    init_platform_db()
    oid = str(uuid.uuid4())
    with _connect() as conn:
        conn.execute(
            "UPDATE otp_challenges SET consumed = 1 WHERE email = ? AND purpose = ? AND consumed = 0",
            (email, purpose),
        )
        conn.execute(
            """
            INSERT INTO otp_challenges
              (id, email, purpose, code_hash, expires_at, attempts, consumed, created_at)
            VALUES (?,?,?,?,?,0,0,?)
            """,
            (oid, email, purpose, code_hash, expires_at, now_iso()),
        )
    return oid


def get_active_otp(email: str, purpose: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT * FROM otp_challenges
            WHERE email = ? AND purpose = ? AND consumed = 0
            ORDER BY created_at DESC LIMIT 1
            """,
            (email, purpose),
        ).fetchone()
    return dict(row) if row else None


def bump_otp_attempts(otp_id: str) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?",
            (otp_id,),
        )


def consume_otp(otp_id: str) -> None:
    with _connect() as conn:
        conn.execute("UPDATE otp_challenges SET consumed = 1 WHERE id = ?", (otp_id,))


def insert_mail_job(to_email: str, subject: str, body: str, available_at: str) -> str:
    init_platform_db()
    jid = str(uuid.uuid4())
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO mail_jobs
              (id, to_email, subject, body, status, attempts, available_at, last_error, created_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (jid, to_email, subject, body, "queued", 0, available_at, None, now_iso()),
        )
    return jid


def due_mail_jobs(limit: int = 8) -> list[dict]:
    init_platform_db()
    ts = now_iso()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM mail_jobs
            WHERE status = 'queued' AND available_at <= ?
            ORDER BY created_at ASC LIMIT ?
            """,
            (ts, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def mark_mail_job(
    job_id: str,
    *,
    status: str,
    attempts: int,
    available_at: str,
    last_error: str | None,
    body: str | None = None,
) -> None:
    with _connect() as conn:
        if body is not None:
            conn.execute(
                """
                UPDATE mail_jobs
                SET status = ?, attempts = ?, available_at = ?, last_error = ?, body = ?
                WHERE id = ?
                """,
                (status, attempts, available_at, last_error, body, job_id),
            )
        else:
            conn.execute(
                """
                UPDATE mail_jobs
                SET status = ?, attempts = ?, available_at = ?, last_error = ?
                WHERE id = ?
                """,
                (status, attempts, available_at, last_error, job_id),
            )


def add_feedback(
    *,
    rating: str,
    title: str,
    message: str,
    conversation_id: str | None,
    client_id: str,
    engine: str | None,
    flags: list[str],
) -> dict:
    init_platform_db()
    fid = str(uuid.uuid4())
    ts = now_iso()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO feedback (
              id, rating, title, message, conversation_id, client_id, engine, flags, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                fid,
                rating,
                title,
                message,
                conversation_id,
                client_id,
                engine,
                json.dumps(flags),
                ts,
            ),
        )
        extra = conn.execute(
            "SELECT id FROM feedback ORDER BY created_at DESC"
        ).fetchall()
        for row in extra[500:]:
            conn.execute("DELETE FROM feedback WHERE id = ?", (row["id"],))
    return {
        "id": fid,
        "rating": rating,
        "title": title,
        "message": message,
        "conversation_id": conversation_id,
        "client_id": client_id,
        "engine": engine,
        "flags": flags,
        "created_at": ts,
    }


def list_feedback(limit: int = 80) -> list[dict]:
    init_platform_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    out = []
    for r in rows:
        row = dict(r)
        try:
            row["flags"] = json.loads(row["flags"] or "[]")
        except json.JSONDecodeError:
            row["flags"] = []
        out.append(row)
    return out
