from __future__ import annotations

import socket
from urllib.parse import urlparse

from config import settings


def livekit_reachable() -> bool:
    parsed = urlparse(settings.livekit_url.replace("ws://", "http://").replace("wss://", "https://"))
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 7880
    try:
        with socket.create_connection((host, port), timeout=0.4):
            return True
    except OSError:
        return False
