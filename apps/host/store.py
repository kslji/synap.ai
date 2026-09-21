import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from config import settings
from instances import current_dir, require_dir
from vault import encrypt_bytes, open_text, seal_text


def _db_path() -> Path:
    return require_dir() / "smallcloud.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db() -> None:
    if current_dir() is None:
        return
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            );
            CREATE TABLE IF NOT EXISTS user_summaries (
              id TEXT PRIMARY KEY,
              owner_id TEXT NOT NULL,
              title TEXT NOT NULL,
              body TEXT NOT NULL,
              source TEXT NOT NULL DEFAULT 'chat',
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_user_summaries_owner
              ON user_summaries(owner_id, updated_at DESC);
            """
        )


def counts() -> dict:
    if current_dir() is None:
        return {"conversations": 0, "messages": 0, "feedback": 0, "users": 0}
    path = _db_path()
    if not path.exists():
        return {"conversations": 0, "messages": 0, "feedback": 0, "users": 0}
    with _connect() as conn:
        conv = conn.execute("SELECT COUNT(*) AS n FROM conversations").fetchone()["n"]
        msgs = conn.execute("SELECT COUNT(*) AS n FROM messages").fetchone()["n"]
        try:
            fb = conn.execute("SELECT COUNT(*) AS n FROM feedback").fetchone()["n"]
        except sqlite3.OperationalError:
            fb = 0
        try:
            users = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
        except sqlite3.OperationalError:
            users = 0
    return {
        "conversations": int(conv),
        "messages": int(msgs),
        "feedback": int(fb),
        "users": int(users),
    }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def list_conversations() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM conversations ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def create_conversation(title: str = "New chat") -> dict:
    cid = str(uuid.uuid4())
    ts = now_iso()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?,?,?,?)",
            (cid, title, ts, ts),
        )
    return {"id": cid, "title": title, "created_at": ts, "updated_at": ts}


def get_messages(conversation_id: str) -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conversation_id,),
        ).fetchall()
    out = []
    for r in rows:
        row = dict(r)
        try:
            row["content"] = open_text(row["content"])
        except PermissionError:
            row["content"] = "[vault locked]"
        out.append(row)
    return out


def add_message(conversation_id: str, role: str, content: str) -> dict:
    mid = str(uuid.uuid4())
    ts = now_iso()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)",
            (mid, conversation_id, role, seal_text(content), ts),
        )
        if role == "user":
            title = content.strip().split("\n")[0][:48] or "New chat"
            conn.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                (title, ts, conversation_id),
            )
        else:
            conn.execute(
                "UPDATE conversations SET updated_at = ? WHERE id = ?",
                (ts, conversation_id),
            )
    return {
        "id": mid,
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "created_at": ts,
    }


def prune() -> None:
    if current_dir() is None:
        return
    with _connect() as conn:
        ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM conversations ORDER BY updated_at DESC"
            ).fetchall()
        ]
        extra = ids[settings.max_conversations :]
        for cid in extra:
            conn.execute("DELETE FROM messages WHERE conversation_id = ?", (cid,))
            conn.execute("DELETE FROM conversations WHERE id = ?", (cid,))
        for cid in ids[: settings.max_conversations ]:
            mids = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC",
                    (cid,),
                ).fetchall()
            ]
            for mid in mids[settings.max_messages_per_conversation :]:
                conn.execute("DELETE FROM messages WHERE id = ?", (mid,))
        try:
            fids = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM feedback ORDER BY created_at DESC"
                ).fetchall()
            ]
            for fid in fids[200:]:
                conn.execute("DELETE FROM feedback WHERE id = ?", (fid,))
        except sqlite3.OperationalError:
            pass
    traces_dir = require_dir() / "traces"
    traces_dir.mkdir(parents=True, exist_ok=True)
    traces = sorted(traces_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in traces[settings.max_trace_files :]:
        path.unlink(missing_ok=True)


def clear_chat_data() -> dict:
    """Erase host-side conversations/messages (keeps accounts). Used by Delete data."""
    if current_dir() is None:
        return {"conversations": 0, "messages": 0, "summaries": 0}
    with _connect() as conn:
        n_msg = conn.execute("SELECT COUNT(*) AS c FROM messages").fetchone()["c"]
        n_convo = conn.execute("SELECT COUNT(*) AS c FROM conversations").fetchone()["c"]
        try:
            n_sum = conn.execute("SELECT COUNT(*) AS c FROM user_summaries").fetchone()["c"]
            conn.execute("DELETE FROM user_summaries")
        except sqlite3.OperationalError:
            n_sum = 0
        conn.execute("DELETE FROM messages")
        conn.execute("DELETE FROM conversations")
    return {"conversations": int(n_convo), "messages": int(n_msg), "summaries": int(n_sum)}


def upsert_user_summary(
    *,
    owner_id: str,
    title: str,
    body: str,
    source: str = "chat",
    summary_id: str | None = None,
) -> dict:
    """Rolling per-user summary — stays in the local instance DB, never the VPS platform DB."""
    owner = (owner_id or "").strip()
    if not owner:
        raise ValueError("owner_id required")
    text = (body or "").strip()
    if not text:
        raise ValueError("empty summary")
    sid = summary_id or str(uuid.uuid4())
    ts = now_iso()
    title_s = (title or "Session summary").strip()[:120] or "Session summary"
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO user_summaries (id, owner_id, title, body, source, updated_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              body = excluded.body,
              source = excluded.source,
              updated_at = excluded.updated_at
            WHERE user_summaries.owner_id = excluded.owner_id
            """,
            (sid, owner, title_s, text[:8000], (source or "chat")[:32], ts),
        )
    return {
        "id": sid,
        "owner_id": owner,
        "title": title_s,
        "body": text[:8000],
        "source": source,
        "updated_at": ts,
    }


def list_user_summaries(owner_id: str, limit: int = 40) -> list[dict]:
    owner = (owner_id or "").strip()
    if not owner:
        return []
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, owner_id, title, body, source, updated_at
            FROM user_summaries
            WHERE owner_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (owner, max(1, min(limit, 200))),
        ).fetchall()
    return [dict(r) for r in rows]


def export_user_summaries(owner_id: str) -> dict:
    """Write this user's summaries into summaries/<owner>/ on disk for offline local use."""
    owner = (owner_id or "").strip()
    if not owner or current_dir() is None:
        return {"ok": False, "files": 0, "dir": None}
    rows = list_user_summaries(owner, limit=200)
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", owner)[:80] or "user"
    out_dir = require_dir() / "summaries" / safe
    out_dir.mkdir(parents=True, exist_ok=True)
    # Clear stale exports for this owner only.
    for old in out_dir.glob("*.md"):
        old.unlink(missing_ok=True)
    written = 0
    index: list[dict] = []
    for i, row in enumerate(rows):
        name = f"{i:03d}-{(row.get('title') or 'summary')[:40]}"
        name = re.sub(r"[^a-zA-Z0-9._-]+", "_", name).strip("_") or f"summary-{i}"
        path = out_dir / f"{name}.md"
        path.write_text(
            f"# {row.get('title') or 'Summary'}\n\n"
            f"_updated {row.get('updated_at')}_ · _{row.get('source')}_\n\n"
            f"{row.get('body') or ''}\n",
            encoding="utf-8",
        )
        written += 1
        index.append({"id": row["id"], "file": path.name, "title": row.get("title")})
    (out_dir / "index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    return {"ok": True, "files": written, "dir": str(out_dir), "owner_id": owner}


def purge_stale_user_summaries(max_age_hours: int = 24) -> int:
    """Drop local summaries not touched within max_age_hours (per-device cleanup)."""
    if current_dir() is None:
        return 0
    cutoff = datetime.now(timezone.utc).timestamp() - max(1, max_age_hours) * 3600
    removed = 0
    with _connect() as conn:
        rows = conn.execute("SELECT id, updated_at FROM user_summaries").fetchall()
        for row in rows:
            try:
                ts = datetime.fromisoformat(str(row["updated_at"]).replace("Z", "+00:00")).timestamp()
            except ValueError:
                ts = 0
            if ts < cutoff:
                conn.execute("DELETE FROM user_summaries WHERE id = ?", (row["id"],))
                removed += 1
    return removed


def write_trace(payload: dict) -> Path:
    traces_dir = require_dir() / "traces"
    traces_dir.mkdir(parents=True, exist_ok=True)
    path = traces_dir / f"{payload['id']}.json"
    raw = json.dumps(payload, indent=2).encode("utf-8")
    path.write_bytes(encrypt_bytes(raw))
    prune()
    return path


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
    init_db()
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
                seal_text(message),
                conversation_id,
                client_id,
                engine,
                json.dumps(flags),
                ts,
            ),
        )
    prune()
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
    with _connect() as conn:
        try:
            rows = conn.execute(
                "SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        except sqlite3.OperationalError:
            return []
    out = []
    for r in rows:
        row = dict(r)
        try:
            row["message"] = open_text(row["message"])
        except PermissionError:
            row["message"] = "[vault locked]"
        try:
            row["flags"] = json.loads(row["flags"] or "[]")
        except json.JSONDecodeError:
            row["flags"] = []
        out.append(row)
    return out


def get_user_by_email(email: str) -> dict | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: str) -> dict | None:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def insert_user(email: str, password_hash: str) -> dict:
    init_db()
    uid = str(uuid.uuid4())
    ts = now_iso()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO users (id, email, password_hash, email_verified, created_at, updated_at)
            VALUES (?,?,?,?,?,?)
            """,
            (uid, email, password_hash, 0, ts, ts),
        )
    return {
        "id": uid,
        "email": email,
        "email_verified": False,
        "created_at": ts,
        "updated_at": ts,
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
    init_db()
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
    init_db()
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
    if current_dir() is None:
        return []
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


def mark_mail_job(job_id: str, *, status: str, attempts: int, available_at: str, last_error: str | None, body: str | None = None) -> None:
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
