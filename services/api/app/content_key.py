"""Seal the pack content key for one activated device.

``build_delta.py`` encrypts ``delta.sqlite.enc`` with ``PACK_CONTENT_KEY_HEX``.
That key is never returned and never stored in git. ``GET /v1/packs/updates``
seals the 32 bytes with NaCl SecretBox under the same SHA-256 the desktop
derives in ``derivePackKey``:

    synap.pack.v1\\n{licence_id}\\n{device_id_hash}

The app unwraps the box with its licence-derived key and caches the content key.
"""
from __future__ import annotations

import hashlib
import os
import re

from nacl.secret import SecretBox

ENV = os.environ
HEX64 = re.compile(r"^[0-9a-fA-F]{64}$")


def derive_pack_key(licence_id: str, device_id_hash: str) -> bytes:
    material = f"synap.pack.v1\n{licence_id}\n{device_id_hash}".encode("utf-8")
    return hashlib.sha256(material).digest()


def content_key_bytes() -> bytes | None:
    raw = ENV.get("PACK_CONTENT_KEY_HEX", "").strip()
    if not HEX64.fullmatch(raw):
        return None
    return bytes.fromhex(raw)


def seal_content_key(content_key: bytes, wrap_key: bytes) -> bytes:
    if len(content_key) != 32 or len(wrap_key) != 32:
        raise ValueError("keys must be 32 bytes")
    return bytes(SecretBox(wrap_key).encrypt(content_key))


def open_content_key(sealed: bytes, wrap_key: bytes) -> bytes:
    opened = SecretBox(wrap_key).decrypt(sealed)
    if len(opened) != 32:
        raise ValueError("content key length")
    return bytes(opened)


async def sealed_for_user(store, user_id: str, device_id_hash: str) -> str | None:
    """Hex of nonce||secretbox, or None when this device should not receive the key."""
    content = content_key_bytes()
    if content is None or not HEX64.fullmatch(device_id_hash or ""):
        return None
    licence = await store.active_for_user(user_id)
    if not licence or licence.get("status") != "active":
        return None
    device = await store.device_by_hash(str(licence["id"]), device_id_hash)
    if not device or device.get("deactivated_at"):
        return None
    wrap = derive_pack_key(str(licence["id"]), str(device["device_id_hash"]))
    return seal_content_key(content, wrap).hex()
