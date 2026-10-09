from app.ssrf import SsrfBlocked, guard_url, ip_blocked, next_hop, robots_allows


def test_private_and_metadata_addresses_are_blocked():
    assert ip_blocked("127.0.0.1")
    assert ip_blocked("10.1.2.3")
    assert ip_blocked("192.168.1.9")
    assert ip_blocked("172.16.0.4")
    assert ip_blocked("169.254.169.254")
    assert ip_blocked("::1")
    assert ip_blocked("2130706433")  # decimal form of 127.0.0.1
    assert not ip_blocked("1.1.1.1")
    assert not ip_blocked("8.8.8.8")


def test_guard_rejects_loopback_metadata_and_odd_ports():
    assert_blocked("http://127.0.0.1/latest/meta-data", "address")
    assert_blocked("http://169.254.169.254/", "address")
    assert_blocked("http://localhost/admin", "host")
    assert_blocked("http://metadata.google.internal/", "host")
    assert_blocked("http://example.com@127.0.0.1/", "userinfo")
    assert_blocked("file:///etc/passwd", "scheme")
    assert_blocked("http://1.1.1.1:8080/", "port")
    assert_blocked("http://2130706433/", "address")


def test_guard_allows_public_addresses_and_explicit_dev_hosts():
    seen = {}

    def resolve(host, port, type):  # noqa: A002
        seen["host"] = host
        return [(None, None, None, None, ("1.1.1.1", port))]

    assert guard_url("https://example.com/a", resolve=resolve) == "https://example.com/a"
    assert seen["host"] == "example.com"
    assert guard_url("http://127.0.0.1:9/beacon", allow={"127.0.0.1"}) == "http://127.0.0.1:9/beacon"


def test_resolved_private_address_is_blocked():
    def resolve(host, port, type):  # noqa: A002
        return [(None, None, None, None, ("10.0.0.8", port))]

    assert_blocked("https://public.example/", "address", resolve=resolve)


def test_redirect_joins_and_robots_disallow():
    assert next_hop("https://example.com/a/b", "/secret") == "https://example.com/secret"
    assert robots_allows("User-agent: *\nDisallow: /private\n", "https://example.com/ok")
    assert not robots_allows("User-agent: *\nDisallow: /\n", "https://example.com/ok")


def assert_blocked(url: str, reason: str, resolve=None) -> None:
    try:
        guard_url(url, resolve=resolve or (lambda *args, **kwargs: []))
    except SsrfBlocked as exc:
        assert exc.reason == reason
        return
    raise AssertionError(f"{url} was allowed")
