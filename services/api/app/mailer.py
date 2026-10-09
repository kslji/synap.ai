"""Pluggable mail. Console is the dev sender. SMTP covers a normal host or Resend's free SMTP."""
from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage

ENV = os.environ


class ConsoleMail:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def send(self, to: str, subject: str, body: str, code: str) -> None:
        self.sent.append({"to": to, "subject": subject, "code": code})
        print(f"[surf-mail] to={to} code={code}", flush=True)


class SmtpMail:
    def send(self, to: str, subject: str, body: str, code: str) -> None:
        host = ENV.get("SMTP_HOST", "")
        if not host:
            raise RuntimeError("SMTP_HOST is empty")
        msg = EmailMessage()
        msg["From"] = ENV.get("SMTP_FROM") or ENV.get("SMTP_USER") or "surf@localhost"
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        port = int(ENV.get("SMTP_PORT", "587"))
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            smtp.starttls()
            user = ENV.get("SMTP_USER", "")
            password = ENV.get("SMTP_PASSWORD", "")
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)


def make_mail() -> ConsoleMail | SmtpMail:
    if ENV.get("MAIL_MODE", "console") == "smtp":
        return SmtpMail()
    return ConsoleMail()
