"""Strip filesystem paths from responses that leave the laptop.

Loopback callers (the local UI, deploy curl on the VPS) still see paths.
Requests that arrived through nginx with a public client IP do not.
"""

from __future__ import annotations

import copy
from typing import Any


def _drop_path_fields(node: Any) -> None:
    if isinstance(node, dict):
        for key in ("data_dir", "user_home", "db", "files"):
            node.pop(key, None)
        for value in node.values():
            _drop_path_fields(value)
    elif isinstance(node, list):
        for item in node:
            _drop_path_fields(item)


def redact_public_payload(payload: dict) -> dict:
    cloned = copy.deepcopy(payload)
    _drop_path_fields(cloned)
    return cloned
