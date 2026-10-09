from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
import smtplib

from config import settings
from platform_store import due_mail_jobs, mark_mail_job, platform_dir

_wakeup: asyncio.Queue[str] | None = None
_task: asyncio.Task | None = None


def notify() -> None:
    if _wakeup is None:
        return
    try:
        _wakeup.put_nowait("job")
    except asyncio.QueueFull:
        pass


def _send_smtp(to_email: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured")
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user or "local-ai@localhost"
    msg["To"] = to_email
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.ehlo()
        if settings.smtp_use_tls:
            smtp.starttls()
            smtp.ehlo()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)


def _write_outbox(to_email: str, subject: str, body: str, job_id: str) -> None:
    path = platform_dir() / "mail-outbox.jsonl"
    # Once SMTP accepted the message, do not keep the OTP on disk.
    stored_body = "[redacted]" if settings.smtp_host else body
    row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "id": job_id,
        "to": to_email,
        "subject": subject,
        "body": stored_body,
        "channel": "smtp" if settings.smtp_host else "local-queue",
    }
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def process_due_jobs() -> int:
    sent = 0
    for job in due_mail_jobs():
        attempts = int(job["attempts"]) + 1
        try:
            if settings.smtp_host:
                _send_smtp(job["to_email"], job["subject"], job["body"])
            _write_outbox(job["to_email"], job["subject"], job["body"], job["id"])
            mark_mail_job(
                job["id"],
                status="sent",
                attempts=attempts,
                available_at=datetime.now(timezone.utc).isoformat(),
                last_error=None,
                body="[redacted after send]",
            )
            sent += 1
        except Exception as exc:
            delay = min(15 * (2 ** min(attempts, 6)), 900)
            nxt = datetime.now(timezone.utc) + timedelta(seconds=delay)
            status = "failed" if attempts >= 8 else "queued"
            mark_mail_job(
                job["id"],
                status=status,
                attempts=attempts,
                available_at=nxt.isoformat(),
                last_error=str(exc)[:400],
            )
    return sent


async def _worker() -> None:
    global _wakeup
    assert _wakeup is not None
    while True:
        try:
            await asyncio.wait_for(_wakeup.get(), timeout=4.0)
        except TimeoutError:
            pass
        except asyncio.CancelledError:
            break
        try:
            process_due_jobs()
        except Exception:
            continue


async def start() -> None:
    global _wakeup, _task
    _wakeup = asyncio.Queue(maxsize=64)
    process_due_jobs()
    _task = asyncio.create_task(_worker())


async def stop() -> None:
    global _task, _wakeup
    if _task:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None
    _wakeup = None
