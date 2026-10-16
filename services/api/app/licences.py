"""Ed25519 device licences.

The signing seed comes from LICENCE_SIGNING_KEY_HEX. It is never written by
this module. A copied installer still needs a signed file the app can check
offline. That check is not a promise that a modified app cannot be patched.
"""
from __future__ import annotations

import base64
import calendar
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

from nacl.exceptions import BadSignatureError
from nacl.signing import SigningKey, VerifyKey

ENV = os.environ
KEY_RE = re.compile(r"[A-Z2-9]{16}")
OS_NAMES = {"macos", "windows", "linux"}
PRO_FEATURES = ["chat", "packs"]
TERM_MONTHS = (1, 3, 6, 12)


class LicenceError(Exception):
    def __init__(self, status: int, code: str, detail: str, retry_after: int | None = None):
        self.status, self.code, self.detail, self.retry_after = status, code, detail, retry_after


def _now() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def refresh_days() -> int:
    return max(1, int(ENV.get("LICENCE_REFRESH_DAYS", "30")))


def grace_days() -> int:
    return max(1, int(ENV.get("LICENCE_GRACE_DAYS", "7")))


def default_max_devices() -> int:
    return max(1, int(ENV.get("LICENCE_MAX_DEVICES", "2")))


def key_id() -> str:
    return ENV.get("LICENCE_KEY_ID", "lic-2026-1").strip() or "lic-2026-1"


def canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def integrity_hex(payload: dict, signature_b64: str) -> str:
    digest = hashlib.sha256()
    digest.update(canonical(payload))
    digest.update(b"\n")
    digest.update(signature_b64.encode("ascii"))
    return digest.hexdigest()


def _seed() -> bytes:
    raw = ENV.get("LICENCE_SIGNING_KEY_HEX", "").strip()
    try:
        seed = bytes.fromhex(raw)
    except ValueError as exc:
        raise LicenceError(503, "licence_unconfigured", "Licence signing key is not set.") from exc
    if len(seed) != 32:
        raise LicenceError(503, "licence_unconfigured", "Licence signing key is not set.")
    return seed


def public_key_hex(seed: bytes | None = None) -> str:
    key = SigningKey(seed if seed is not None else _seed())
    return key.verify_key.encode().hex()


def sign_payload(payload: dict, seed: bytes | None = None) -> dict:
    body = canonical(payload)
    signed = SigningKey(seed if seed is not None else _seed()).sign(body)
    signature = base64.b64encode(signed.signature).decode("ascii")
    return {
        "payload": payload,
        "signature": signature,
        "key_id": payload["key_id"],
        "integrity": integrity_hex(payload, signature),
    }


def verify_payload(payload: dict, signature_b64: str, public_hex: str) -> bool:
    try:
        raw = base64.b64decode(signature_b64, validate=True)
        VerifyKey(bytes.fromhex(public_hex)).verify(canonical(payload), raw)
    except (BadSignatureError, ValueError):
        return False
    return True


def normalize_key(raw: str) -> str:
    compact = "".join(raw.split()).upper().replace("-", "")
    if not compact.startswith("SYNAP"):
        raise LicenceError(400, "invalid_key", "Enter the licence key from your email.")
    body = compact[5:]
    if not KEY_RE.fullmatch(body or ""):
        raise LicenceError(400, "invalid_key", "Enter the licence key from your email.")
    groups = [body[i:i + 4] for i in range(0, 16, 4)]
    return "SYNAP-" + "-".join(groups)


def hash_key(normalized: str) -> str:
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def new_key() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    body = "".join(secrets.choice(alphabet) for _ in range(16))
    groups = [body[i:i + 4] for i in range(0, 16, 4)]
    return "SYNAP-" + "-".join(groups)


def parse_term(value: object, default: int | None = 1) -> int:
    if value is None or value == "":
        if default is None:
            raise LicenceError(400, "invalid_term", "Plan length must be 1, 3, 6, or 12 months.")
        return default
    try:
        months = int(str(value))
    except (TypeError, ValueError) as exc:
        raise LicenceError(400, "invalid_term", "Plan length must be 1, 3, 6, or 12 months.") from exc
    if months not in TERM_MONTHS:
        raise LicenceError(400, "invalid_term", "Plan length must be 1, 3, 6, or 12 months.")
    return months


def add_months(moment: datetime, months: int) -> datetime:
    if months not in TERM_MONTHS:
        raise LicenceError(400, "invalid_term", "Plan length must be 1, 3, 6, or 12 months.")
    base = moment.astimezone(timezone.utc)
    index = base.month - 1 + months
    year = base.year + index // 12
    month = index % 12 + 1
    day = min(base.day, calendar.monthrange(year, month)[1])
    return base.replace(year=year, month=month, day=day)


def as_utc(value: datetime | str) -> datetime:
    if isinstance(value, str):
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def extend_subscription(current: datetime | str | None, now: datetime, months: int) -> datetime:
    """Next end is the plan length after the later of now and the current end."""
    base = now.astimezone(timezone.utc)
    if current is not None:
        existing = as_utc(current)
        if existing > base:
            base = existing
    return add_months(base, months)


def build_payload(licence: dict, device_id_hash: str, now: datetime | None = None) -> dict:
    now = now or _now()
    refresh_by = now + timedelta(days=refresh_days())
    expires_at = refresh_by + timedelta(days=grace_days())
    features = sorted(str(item) for item in (licence.get("features") or PRO_FEATURES))
    ends = licence.get("subscription_ends_at")
    if ends is None:
        raise LicenceError(500, "licence_unconfigured", "This licence has no subscription end date.")
    return {
        "account": licence["user_id"],
        "device_id_hash": device_id_hash,
        "expires_at": iso(expires_at),
        "features": features,
        "issued_at": iso(now),
        "key_id": key_id(),
        "licence_id": licence["id"],
        "plan": licence["plan_code"],
        "refresh_by": iso(refresh_by),
        "subscription_ends_at": iso(as_utc(ends)),
        "term_months": parse_term(licence.get("term_months"), None),
    }


def _eq(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def verify_stripe(body: bytes, header: str, secret: str, now: int | None = None, tolerance: int = 300) -> bool:
    if not header or not secret:
        return False
    now = int(time.time()) if now is None else now
    parts: dict[str, list[str]] = {}
    for item in header.split(","):
        if "=" not in item:
            continue
        name, value = item.split("=", 1)
        parts.setdefault(name.strip(), []).append(value.strip())
    stamps = parts.get("t") or []
    sigs = parts.get("v1") or []
    if not stamps or not sigs:
        return False
    try:
        stamp = int(stamps[0])
    except ValueError:
        return False
    if abs(now - stamp) > tolerance:
        return False
    mac = hmac.new(secret.encode("utf-8"), f"{stamp}.".encode("ascii") + body, hashlib.sha256).hexdigest()
    return any(_eq(mac, sig) for sig in sigs)


def verify_razorpay(body: bytes, header: str, secret: str) -> bool:
    if not header or not secret:
        return False
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return _eq(mac, header.strip())


def stripe_header(secret: str, body: bytes, now: int | None = None) -> str:
    stamp = int(time.time()) if now is None else now
    mac = hmac.new(secret.encode("utf-8"), f"{stamp}.".encode("ascii") + body, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={mac}"


def razorpay_header(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


class ActivationWindow:
    """Fixed-window counter. Failed guesses count, so a key cannot be sprayed."""

    def __init__(self, limit: int, window: int):
        self.limit = limit
        self.window = window
        self.events: dict[str, list[int]] = {}

    def hit(self, key: str, now: int | None = None) -> tuple[bool, int]:
        now = int(time.time()) if now is None else now
        kept = [stamp for stamp in self.events.get(key, []) if now - stamp < self.window]
        if len(kept) >= self.limit:
            self.events[key] = kept
            return False, max(1, self.window - (now - kept[0]))
        kept.append(now)
        self.events[key] = kept
        return True, 0


def judge_activation(count: int, limit: int) -> bool:
    return count <= limit


def _status_error(status: str) -> LicenceError:
    if status == "revoked":
        return LicenceError(403, "licence_revoked", "This licence was revoked.")
    if status == "refunded":
        return LicenceError(403, "licence_refunded", "This licence was refunded.")
    return LicenceError(403, "licence_inactive", "This licence is not active.")


def _require_active(licence: dict) -> None:
    if licence["status"] != "active":
        raise _status_error(licence["status"])


async def issue_for(store, licence: dict, device_id_hash: str, name: str | None, os_name: str, now: datetime) -> dict:
    if os_name not in OS_NAMES:
        raise LicenceError(400, "invalid_device", "os must be macos, windows, or linux.")
    if not re.fullmatch(r"[0-9a-f]{64}", device_id_hash):
        raise LicenceError(400, "invalid_device", "device id is not valid.")
    _require_active(licence)
    active = await store.active_devices(licence["id"])
    existing = next((row for row in active if row["device_id_hash"] == device_id_hash), None)
    if existing is None and len(active) >= int(licence["max_devices"]):
        raise LicenceError(403, "device_limit", f"This licence allows {licence['max_devices']} devices. Remove one to continue.")
    if existing is None:
        await store.add_device(licence["id"], device_id_hash, (name or "Synap.surf")[:80], os_name, now)
        used = len(active) + 1
    else:
        await store.touch(existing["id"], now)
        used = len(active)
    signed = sign_payload(build_payload(licence, device_id_hash, now))
    return {"licence": signed, "devices_used": used, "max_devices": int(licence["max_devices"])}


async def activate(store, user: dict | None, device_id_hash: str, key: str | None, name: str | None, os_name: str, now: datetime | None = None) -> dict:
    now = now or _now()
    if key:
        try:
            normalized = normalize_key(key)
        except LicenceError:
            raise
        found = await store.by_key_hash(hash_key(normalized))
        if not found:
            raise LicenceError(401, "invalid_key", "That licence key was not recognised.")
        if user and user["id"] != found["user_id"]:
            raise LicenceError(403, "key_account_mismatch", "That key belongs to a different account.")
        licence = found
    else:
        if not user:
            raise LicenceError(401, "unauthenticated", "Sign in or enter a licence key.")
        licence = await store.active_for_user(user["id"])
        if not licence:
            raise LicenceError(404, "no_licence", "This account does not have a licence yet.")
    return await issue_for(store, licence, device_id_hash, name, os_name, now)


async def refresh(store, licence_id: str, device_id_hash: str, now: datetime | None = None) -> dict:
    now = now or _now()
    licence = await store.by_id(licence_id)
    if not licence:
        raise LicenceError(404, "not_found", "That licence was not found.")
    _require_active(licence)
    active = await store.active_devices(licence["id"])
    existing = next((row for row in active if row["device_id_hash"] == device_id_hash), None)
    if not existing:
        raise LicenceError(403, "device_not_active", "This device is not activated for that licence.")
    await store.touch(existing["id"], now)
    return {"licence": sign_payload(build_payload(licence, device_id_hash, now))}


async def renew(store, licence_id: str, term_months: int, now: datetime | None = None) -> dict:
    now = now or _now()
    months = parse_term(term_months, None)
    licence = await store.by_id(licence_id)
    if not licence:
        raise LicenceError(404, "not_found", "That licence was not found.")
    _require_active(licence)
    ends = extend_subscription(licence.get("subscription_ends_at"), now, months)
    await store.set_subscription(licence["id"], ends, months, now)
    return {
        "ok": True,
        "licence_id": licence["id"],
        "term_months": months,
        "subscription_ends_at": iso(ends),
    }


async def deactivate(store, user: dict | None, activation_id: str | None, licence_id: str | None, device_id_hash: str | None, now: datetime | None = None) -> dict:
    now = now or _now()
    if user:
        owned = await store.licences_for_user(user["id"])
        owned_ids = {row["id"] for row in owned}
        row = None
        if activation_id:
            row = await store.device_by_id(activation_id)
        elif licence_id and device_id_hash:
            row = await store.device_by_hash(licence_id, device_id_hash)
        elif device_id_hash:
            for item in owned:
                found = await store.device_by_hash(item["id"], device_id_hash)
                if found and not found.get("deactivated_at"):
                    row = found
                    break
        if not row or row["licence_id"] not in owned_ids or row.get("deactivated_at"):
            raise LicenceError(404, "not_found", "That device is not active on this account.")
        await store.deactivate(row["id"], now)
        return {"ok": True, "device_id_hash": row["device_id_hash"], "licence_id": row["licence_id"]}
    if not licence_id or not device_id_hash:
        raise LicenceError(401, "unauthenticated", "Sign in to manage devices.")
    row = await store.device_by_hash(licence_id, device_id_hash)
    if not row or row.get("deactivated_at"):
        raise LicenceError(404, "not_found", "That device is not active.")
    await store.deactivate(row["id"], now)
    return {"ok": True, "device_id_hash": row["device_id_hash"], "licence_id": row["licence_id"]}


async def list_devices(store, user_id: str) -> dict:
    licence = await store.active_for_user(user_id) or await store.latest_for_user(user_id)
    if not licence:
        return {"plan": None, "max_devices": 0, "status": "none", "licence_id": None, "devices": []}
    rows = await store.active_devices(licence["id"])
    return {
        "plan": licence["plan_code"],
        "max_devices": int(licence["max_devices"]),
        "status": licence["status"],
        "licence_id": licence["id"],
        "term_months": int(licence["term_months"]),
        "subscription_ends_at": iso(as_utc(licence["subscription_ends_at"])),
        "devices": [
            {
                "id": row["id"],
                "name": row["name"],
                "os": row["os"],
                "device_id_hash": row["device_id_hash"],
            }
            for row in rows
        ],
    }


def _email_of(event: dict, provider: str) -> str:
    if provider == "stripe":
        obj = (event.get("data") or {}).get("object") or {}
        return str(obj.get("customer_email") or obj.get("receipt_email") or (obj.get("metadata") or {}).get("email") or "")
    payment = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
    order = ((event.get("payload") or {}).get("order") or {}).get("entity") or {}
    refund = ((event.get("payload") or {}).get("refund") or {}).get("entity") or {}
    notes = payment.get("notes") or order.get("notes") or refund.get("notes") or {}
    return str(payment.get("email") or order.get("email") or notes.get("email") or "")


def _provider_ref(event: dict, provider: str) -> str:
    if provider == "stripe":
        obj = (event.get("data") or {}).get("object") or {}
        return str(obj.get("payment_intent") or obj.get("id") or "")
    payment = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
    refund = ((event.get("payload") or {}).get("refund") or {}).get("entity") or {}
    order = ((event.get("payload") or {}).get("order") or {}).get("entity") or {}
    return str(refund.get("payment_id") or payment.get("id") or order.get("id") or "")


def _term_of(event: dict, provider: str) -> int:
    if provider == "stripe":
        obj = (event.get("data") or {}).get("object") or {}
        notes = obj.get("metadata") or {}
    else:
        payment = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
        order = ((event.get("payload") or {}).get("order") or {}).get("entity") or {}
        notes = payment.get("notes") or order.get("notes") or {}
    raw = notes.get("term_months", notes.get("months"))
    return parse_term(raw, 1)


def _licence_id_hint(event: dict, provider: str) -> str:
    if provider == "stripe":
        obj = (event.get("data") or {}).get("object") or {}
        return str((obj.get("metadata") or {}).get("licence_id") or "")
    refund = ((event.get("payload") or {}).get("refund") or {}).get("entity") or {}
    payment = ((event.get("payload") or {}).get("payment") or {}).get("entity") or {}
    notes = refund.get("notes") or payment.get("notes") or {}
    return str(notes.get("licence_id") or "")


def webhook_action(provider: str, event: dict) -> str | None:
    if provider == "stripe":
        kind = str(event.get("type") or "")
        if kind in {"checkout.session.completed", "payment_intent.succeeded"}:
            return "grant"
        if kind in {"charge.refunded", "charge.refund.updated"}:
            return "refund"
        return None
    kind = str(event.get("event") or "")
    if kind in {"payment.captured", "order.paid"}:
        return "grant"
    if kind == "refund.processed":
        return "refund"
    return None


async def apply_webhook(store, auth, provider: str, event: dict, now: datetime | None = None) -> dict:
    now = now or _now()
    action = webhook_action(provider, event)
    if action is None:
        return {"ok": True, "ignored": True}
    if action == "grant" and provider == "stripe":
        paid = str(((event.get("data") or {}).get("object") or {}).get("payment_status") or "")
        if paid and paid not in {"paid", "no_payment_required"}:
            return {"ok": True, "ignored": True}
    if action == "refund":
        hint = _licence_id_hint(event, provider)
        ref = _provider_ref(event, provider)
        licence = None
        if hint:
            licence = await store.by_id(hint)
        if licence is None and ref:
            licence = await store.by_provider(provider, ref)
        if licence is None:
            raise LicenceError(404, "not_found", "No licence matches that refund.")
        await store.set_status(licence["id"], "refunded", now)
        return {"ok": True, "licence_id": licence["id"], "status": "refunded"}
    email = _email_of(event, provider).strip().lower()
    if "@" not in email:
        raise LicenceError(400, "invalid_email", "The payment has no email address.")
    ref = _provider_ref(event, provider)
    if ref:
        existing = await store.by_provider(provider, ref)
        if existing:
            return {"ok": True, "licence_id": existing["id"], "created": False, "status": existing["status"]}
    term = _term_of(event, provider)
    user = await auth.upsert_user(email)
    current = await store.active_for_user(user["id"])
    if current:
        ends = extend_subscription(current.get("subscription_ends_at"), now, term)
        await store.set_subscription(current["id"], ends, term, now, provider, ref or None)
        return {
            "ok": True,
            "created": False,
            "renewed": True,
            "licence_id": current["id"],
            "status": "active",
            "term_months": term,
            "subscription_ends_at": iso(ends),
        }
    raw = new_key()
    ends = add_months(now, term)
    licence = await store.insert_key({
        "user_id": user["id"],
        "key_hash": hash_key(raw),
        "key_hint": raw[-4:],
        "plan_code": "pro",
        "features": list(PRO_FEATURES),
        "max_devices": default_max_devices(),
        "status": "active",
        "provider": provider,
        "provider_ref": ref or None,
        "created_at": now,
        "term_months": term,
        "subscription_ends_at": ends,
    })
    return {
        "ok": True,
        "created": True,
        "licence_id": licence["id"],
        "status": "active",
        "term_months": term,
        "subscription_ends_at": iso(ends),
        "key_hint": licence["key_hint"],
        "dev_key": raw if ENV.get("MAIL_MODE", "console") != "smtp" else None,
        "email": email,
        "raw_key": raw,
    }
