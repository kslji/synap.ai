"""Block fetches that would touch the local machine or a cloud metadata address."""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

MAX_BYTES = 1_000_000
ALLOWED_PORTS = {80, 443}
BLOCKED_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata.google",
}


class SsrfBlocked(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def ip_blocked(value: str) -> bool:
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        if value.isdigit():
            try:
                addr = ipaddress.ip_address(int(value))
            except ValueError:
                return True
        else:
            return False
    if getattr(addr, "ipv4_mapped", None) is not None:
        addr = addr.ipv4_mapped
    return bool(
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _literal_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        if host.isdigit():
            try:
                return ipaddress.ip_address(int(host))
            except ValueError:
                return None
        return None
    mapped = getattr(addr, "ipv4_mapped", None)
    return mapped or addr


def guard_url(url: str, allow: set[str] | None = None, resolve=socket.getaddrinfo) -> str:
    """Return the URL if it is http(s) and every resolved address is public."""
    parts = urlsplit(url.strip())
    if parts.scheme not in {"http", "https"}:
        raise SsrfBlocked("scheme")
    if parts.username or parts.password:
        raise SsrfBlocked("userinfo")
    host = (parts.hostname or "").strip().lower().rstrip(".")
    if not host or host in BLOCKED_HOSTS or host.endswith(".local") or host.endswith(".internal"):
        raise SsrfBlocked("host")
    allowed = {item.lower() for item in (allow or set())}
    port = parts.port
    if host not in allowed and port not in (None, *ALLOWED_PORTS):
        raise SsrfBlocked("port")
    literal = _literal_ip(host)
    if literal is not None:
        if host not in allowed and ip_blocked(str(literal)):
            raise SsrfBlocked("address")
        return url
    if host in allowed:
        return url
    try:
        infos = resolve(host, port or (443 if parts.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SsrfBlocked("dns") from exc
    addresses = {info[4][0] for info in infos}
    if not addresses or any(ip_blocked(addr) for addr in addresses):
        raise SsrfBlocked("address")
    return url


def next_hop(current: str, location: str) -> str:
    return urljoin(current, location)


def robots_allows(body: str, url: str, agent: str = "SurfAI") -> bool:
    from urllib.robotparser import RobotFileParser

    parser = RobotFileParser()
    parser.parse(body.splitlines())
    return bool(parser.can_fetch(agent, url))
