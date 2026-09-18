"""AES-256-GCM vault. Optional master password via Argon2id. Password is never stored."""

from __future__ import annotations

import json
import os
import secrets
from base64 import b64decode, b64encode
from typing import Optional

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from instances import require_dir


def _wrap_path():
    return require_dir() / "vault.wrap.json"


PREFIX = "enc1:"
VAULT_AAD = b"local-ai-vault"
LEGACY_VAULT_AADS = (b"local-ai-vault", b"synap-vault")

_session_key: Optional[bytes] = None


def _kdf(password: str, salt: bytes) -> bytes:
    return hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=3,
        memory_cost=64 * 1024,
        parallelism=2,
        hash_len=32,
        type=Type.ID,
    )


def status() -> dict:
    from instances import current_dir

    if current_dir() is None:
        return {
            "password_set": False,
            "unlocked": False,
            "algorithm": "AES-256-GCM",
            "kdf": "Argon2id",
            "note": "Create a local instance first. Master password never leaves the device.",
        }
    wrapped = _wrap_path().exists()
    return {
        "password_set": wrapped,
        "unlocked": _session_key is not None or not wrapped,
        "algorithm": "AES-256-GCM",
        "kdf": "Argon2id",
        "note": "Master password never leaves the device and is not stored.",
    }


def needs_unlock() -> bool:
    from instances import current_dir

    if current_dir() is None:
        return True
    return _wrap_path().exists() and _session_key is None


def current_key() -> bytes:
    if _session_key is not None:
        return _session_key
    if _wrap_path().exists():
        raise PermissionError("vault_locked")
    # Demo mode: random device key persisted so restarts still decrypt.
    key_path = require_dir() / "vault.device.key"
    if key_path.exists():
        return key_path.read_bytes()
    key = secrets.token_bytes(32)
    key_path.write_bytes(key)
    key_path.chmod(0o600)
    return key


def setup(password: str) -> dict:
    global _session_key
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters")
    data_key = secrets.token_bytes(32)
    salt = secrets.token_bytes(16)
    wrap_key = _kdf(password, salt)
    nonce = os.urandom(12)
    wrapped = AESGCM(wrap_key).encrypt(nonce, data_key, VAULT_AAD)
    wrap_path = _wrap_path()
    wrap_path.write_text(
        json.dumps(
            {
                "kdf": "argon2id",
                "salt": b64encode(salt).decode(),
                "nonce": b64encode(nonce).decode(),
                "wrapped_key": b64encode(wrapped).decode(),
            }
        ),
        encoding="utf-8",
    )
    wrap_path.chmod(0o600)
    _session_key = data_key
    return status()


def unlock(password: str) -> dict:
    global _session_key
    wrap_path = _wrap_path()
    if not wrap_path.exists():
        return setup(password)
    blob = json.loads(wrap_path.read_text(encoding="utf-8"))
    salt = b64decode(blob["salt"])
    nonce = b64decode(blob["nonce"])
    wrapped = b64decode(blob["wrapped_key"])
    wrap_key = _kdf(password, salt)
    last_error: Exception | None = None
    for aad in LEGACY_VAULT_AADS:
        try:
            _session_key = AESGCM(wrap_key).decrypt(nonce, wrapped, aad)
            last_error = None
            break
        except Exception as exc:
            last_error = exc
    if last_error is not None or _session_key is None:
        raise PermissionError("bad_password") from last_error
    return status()


def lock() -> dict:
    global _session_key
    _session_key = None
    return status()


def seal_text(plain: str) -> str:
    key = current_key()
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plain.encode("utf-8"), None)
    return PREFIX + b64encode(nonce + ct).decode("ascii")


def open_text(value: str) -> str:
    if not value.startswith(PREFIX):
        return value
    raw = b64decode(value[len(PREFIX) :])
    nonce, ct = raw[:12], raw[12:]
    return AESGCM(current_key()).decrypt(nonce, ct, None).decode("utf-8")


def encrypt_bytes(plain: bytes) -> bytes:
    nonce = os.urandom(12)
    ct = AESGCM(current_key()).encrypt(nonce, plain, None)
    return nonce + ct


def decrypt_bytes(blob: bytes) -> bytes:
    nonce, ct = blob[:12], blob[12:]
    return AESGCM(current_key()).decrypt(nonce, ct, None)
