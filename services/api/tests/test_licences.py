import json
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
os.environ["SURF_API_LITE"] = "1"
os.environ["SEARXNG_URL"] = "http://stub.local/search"
os.environ["MAIL_MODE"] = "console"
os.environ["LICENCE_SIGNING_KEY_HEX"] = "11" * 32
os.environ["LICENCE_KEY_ID"] = "lic-test"
os.environ["LICENCE_MAX_DEVICES"] = "2"
os.environ["LICENCE_REFRESH_DAYS"] = "30"
os.environ["LICENCE_GRACE_DAYS"] = "7"
os.environ["LICENCE_ADMIN_TOKEN"] = "admin-token-for-tests"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test"
os.environ["RAZORPAY_WEBHOOK_SECRET"] = "razor_test"

from fastapi.testclient import TestClient  # noqa: E402

from app.licences import add_months, extend_subscription, public_key_hex, stripe_header, verify_payload, verify_stripe, razorpay_header  # noqa: E402
from app.main import app  # noqa: E402


def _device(n: int) -> str:
    return f"{n:064x}"


def _parse(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _grant(client: TestClient, email: str = "ada@example.com", ref: str = "cs_test_1", months: int = 1) -> str:
    event = {
        "id": "evt_1",
        "type": "checkout.session.completed",
        "data": {"object": {"id": ref, "customer_email": email, "payment_status": "paid", "metadata": {"plan": "pro", "term_months": months}}},
    }
    body = json.dumps(event).encode()
    response = client.post(
        "/v1/billing/stripe",
        content=body,
        headers={"stripe-signature": stripe_header("whsec_test", body), "content-type": "application/json"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["created"] is True
    return response.json()["dev_key"]


def _session(client: TestClient, email: str, uid: str) -> dict:
    started = client.post("/v1/auth/otp/start", json={"email": email})
    assert started.status_code == 200, started.text
    verified = client.post("/v1/auth/otp/verify", json={
        "email": email,
        "code": started.json()["dev_code"],
        "device": {"device_uid": uid, "name": "Desk", "os": "linux", "arch": "x64", "app_version": "0.1.0"},
    })
    assert verified.status_code == 200, verified.text
    return verified.json()


def test_signature_round_trip_and_forge():
    with TestClient(app) as client:
        key = _grant(client)
        activated = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(1), "os": "linux", "name": "Desk"})
        assert activated.status_code == 200, activated.text
        licence = activated.json()["licence"]
        public = public_key_hex()
        assert verify_payload(licence["payload"], licence["signature"], public)
        forged = dict(licence["payload"])
        forged["plan"] = "fleet"
        assert verify_payload(forged, licence["signature"], public) is False
        assert licence["payload"]["device_id_hash"] == _device(1)
        assert licence["payload"]["plan"] == "pro"
        assert "packs" in licence["payload"]["features"]
        assert "pack_updates" in licence["payload"]["features"]
        issued = datetime.strptime(licence["payload"]["issued_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        refresh_by = datetime.strptime(licence["payload"]["refresh_by"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        expires = datetime.strptime(licence["payload"]["expires_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        assert refresh_by - issued == timedelta(days=30)
        assert expires - refresh_by == timedelta(days=7)
        assert licence["payload"]["term_months"] == 1
        assert abs((_parse(licence["payload"]["subscription_ends_at"]) - add_months(issued, 1)).total_seconds()) < 5


def test_device_limit_refresh_deactivate_and_revoke():
    with TestClient(app) as client:
        email = "bridge@example.com"
        key = _grant(client, email, "cs_limit")
        first = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(1), "os": "linux"})
        second = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(2), "os": "macos"})
        third = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(3), "os": "windows"})
        assert first.status_code == 200
        assert second.status_code == 200
        assert third.status_code == 403
        assert third.json()["error"]["code"] == "device_limit"
        session = _session(client, email, "login-device")
        headers = {"authorization": f"Bearer {session['access_token']}"}
        listed = client.get("/v1/licences/devices", headers=headers)
        assert listed.status_code == 200
        body = listed.json()
        assert body["plan"] == "pro"
        assert body["max_devices"] == 2
        assert len(body["devices"]) == 2
        removed = client.post("/v1/licences/deactivate", headers=headers, json={"activation_id": body["devices"][0]["id"]})
        assert removed.status_code == 200, removed.text
        again = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(3), "os": "windows"})
        assert again.status_code == 200, again.text
        licence_id = again.json()["licence"]["payload"]["licence_id"]
        refreshed = client.post("/v1/licences/refresh", json={"licence_id": licence_id, "device_id_hash": _device(3)})
        assert refreshed.status_code == 200, refreshed.text
        assert verify_payload(refreshed.json()["licence"]["payload"], refreshed.json()["licence"]["signature"], public_key_hex())
        self_off = client.post("/v1/licences/deactivate", json={"licence_id": licence_id, "device_id_hash": _device(3)})
        assert self_off.status_code == 200
        blocked = client.post("/v1/licences/refresh", json={"licence_id": licence_id, "device_id_hash": _device(3)})
        assert blocked.status_code == 403
        assert blocked.json()["error"]["code"] == "device_not_active"
        # Put the device back, then revoke the whole licence.
        restored = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(3), "os": "windows"})
        assert restored.status_code == 200
        revoked = client.post(
            "/v1/licences/revoke",
            headers={"x-licence-admin": "admin-token-for-tests"},
            json={"licence_id": licence_id, "reason": "revoked"},
        )
        assert revoked.status_code == 200
        dead = client.post("/v1/licences/refresh", json={"licence_id": licence_id, "device_id_hash": _device(3)})
        assert dead.status_code == 403
        assert dead.json()["error"]["code"] == "licence_revoked"


def test_plan_lengths_and_renewal_extension():
    start = datetime(2026, 10, 16, tzinfo=timezone.utc)
    assert add_months(start, 1) == datetime(2026, 11, 16, tzinfo=timezone.utc)
    assert add_months(start, 3) == datetime(2027, 1, 16, tzinfo=timezone.utc)
    assert add_months(start, 6) == datetime(2027, 4, 16, tzinfo=timezone.utc)
    assert add_months(start, 12) == datetime(2027, 10, 16, tzinfo=timezone.utc)
    assert add_months(datetime(2026, 1, 31, tzinfo=timezone.utc), 1) == datetime(2026, 2, 28, tzinfo=timezone.utc)
    later = datetime(2026, 12, 1, tzinfo=timezone.utc)
    assert extend_subscription(later, start, 3) == datetime(2027, 3, 1, tzinfo=timezone.utc)
    assert extend_subscription(datetime(2026, 9, 1, tzinfo=timezone.utc), start, 1) == datetime(2026, 11, 16, tzinfo=timezone.utc)

    with TestClient(app) as client:
        for months in (1, 3, 6, 12):
            key = _grant(client, f"term{months}@example.com", f"cs_term_{months}", months)
            activated = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(20 + months), "os": "linux"})
            assert activated.status_code == 200, activated.text
            body = activated.json()["licence"]["payload"]
            assert body["term_months"] == months
            issued = _parse(body["issued_at"])
            assert abs((_parse(body["subscription_ends_at"]) - add_months(issued, months)).total_seconds()) < 5

        key = _grant(client, "renew@example.com", "cs_renew_1", 1)
        activated = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(30), "os": "linux"})
        assert activated.status_code == 200, activated.text
        first = activated.json()["licence"]["payload"]
        first_end = _parse(first["subscription_ends_at"])
        event = {
            "id": "evt_renew",
            "type": "checkout.session.completed",
            "data": {"object": {"id": "cs_renew_2", "customer_email": "renew@example.com", "payment_status": "paid", "metadata": {"term_months": 3}}},
        }
        raw = json.dumps(event).encode()
        renewed = client.post("/v1/billing/stripe", content=raw, headers={"stripe-signature": stripe_header("whsec_test", raw), "content-type": "application/json"})
        assert renewed.status_code == 200, renewed.text
        assert renewed.json()["renewed"] is True
        assert renewed.json()["created"] is False
        extended = _parse(renewed.json()["subscription_ends_at"])
        assert extended == add_months(first_end, 3)
        replay = client.post("/v1/billing/stripe", content=raw, headers={"stripe-signature": stripe_header("whsec_test", raw), "content-type": "application/json"})
        assert replay.status_code == 200, replay.text
        assert replay.json().get("renewed") is not True
        refreshed = client.post("/v1/licences/refresh", json={"licence_id": first["licence_id"], "device_id_hash": _device(30)})
        assert refreshed.status_code == 200, refreshed.text
        assert _parse(refreshed.json()["licence"]["payload"]["subscription_ends_at"]) == extended
        assert refreshed.json()["licence"]["payload"]["term_months"] == 3
        admin = client.post(
            "/v1/licences/renew",
            headers={"x-licence-admin": "admin-token-for-tests"},
            json={"licence_id": first["licence_id"], "term_months": 12},
        )
        assert admin.status_code == 200, admin.text
        admin_end = _parse(admin.json()["subscription_ends_at"])
        assert admin_end == add_months(extended, 12)
        again = client.post("/v1/licences/refresh", json={"licence_id": first["licence_id"], "device_id_hash": _device(30)})
        assert again.status_code == 200, again.text
        assert _parse(again.json()["licence"]["payload"]["subscription_ends_at"]) == admin_end
        bad = client.post(
            "/v1/licences/renew",
            headers={"x-licence-admin": "admin-token-for-tests"},
            json={"licence_id": first["licence_id"], "term_months": 2},
        )
        assert bad.status_code == 400
        assert bad.json()["error"]["code"] == "invalid_term"


def test_signed_in_account_activates_without_a_key():
    with TestClient(app) as client:
        email = "crew@example.com"
        _grant(client, email, "cs_account")
        session = _session(client, email, "ship-laptop")
        headers = {"authorization": f"Bearer {session['access_token']}"}
        activated = client.post("/v1/licences/activate", headers=headers, json={"device_id_hash": _device(9), "os": "linux", "name": "Ship"})
        assert activated.status_code == 200, activated.text
        assert activated.json()["licence"]["payload"]["account"]
        other = _session(client, "other@example.com", "other-box")
        foreign = _grant(client, "owner@example.com", "cs_foreign")
        mismatch = client.post(
            "/v1/licences/activate",
            headers={"authorization": f"Bearer {other['access_token']}"},
            json={"key": foreign, "device_id_hash": _device(4), "os": "linux"},
        )
        assert mismatch.status_code == 403
        assert mismatch.json()["error"]["code"] == "key_account_mismatch"


def test_razorpay_payment_creates_a_key():
    with TestClient(app) as client:
        event = {
            "event": "payment.captured",
            "payload": {"payment": {"entity": {"id": "pay_1", "email": "pay@example.com", "notes": {"plan": "pro"}}}},
        }
        body = json.dumps(event).encode()
        response = client.post(
            "/v1/billing/razorpay",
            content=body,
            headers={"x-razorpay-signature": razorpay_header("razor_test", body), "content-type": "application/json"},
        )
        assert response.status_code == 200, response.text
        key = response.json()["dev_key"]
        activated = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(8), "os": "linux"})
        assert activated.status_code == 200, activated.text
        again = client.post(
            "/v1/billing/razorpay",
            content=body,
            headers={"x-razorpay-signature": razorpay_header("razor_test", body), "content-type": "application/json"},
        )
        assert again.status_code == 200
        assert again.json()["created"] is False
        assert "dev_key" not in again.json()


def test_refund_webhook_blocks_refresh():
    with TestClient(app) as client:
        key = _grant(client, "refund@example.com", "cs_refund")
        activated = client.post("/v1/licences/activate", json={"key": key, "device_id_hash": _device(5), "os": "linux"})
        assert activated.status_code == 200
        licence_id = activated.json()["licence"]["payload"]["licence_id"]
        event = {
            "event": "refund.processed",
            "payload": {"refund": {"entity": {"id": "rf_1", "payment_id": "pay_refund", "notes": {"licence_id": licence_id}}}},
        }
        body = json.dumps(event).encode()
        response = client.post(
            "/v1/billing/razorpay",
            content=body,
            headers={"x-razorpay-signature": razorpay_header("razor_test", body), "content-type": "application/json"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "refunded"
        refreshed = client.post("/v1/licences/refresh", json={"licence_id": licence_id, "device_id_hash": _device(5)})
        assert refreshed.status_code == 403
        assert refreshed.json()["error"]["code"] == "licence_refunded"


def test_webhook_signatures_and_activation_rate_limit():
    body = b'{"type":"checkout.session.completed","data":{"object":{"id":"cs_x","customer_email":"a@b.co"}}}'
    assert verify_stripe(body, stripe_header("whsec_test", body), "whsec_test")
    assert verify_stripe(body, stripe_header("whsec_test", body), "other") is False
    with TestClient(app) as client:
        bad = client.post("/v1/billing/stripe", content=body, headers={"stripe-signature": "t=1,v1=00"})
        assert bad.status_code == 400
        assert bad.json()["error"]["code"] == "bad_signature"
        os.environ["ACTIVATION_LIMIT"] = "2"
        try:
            limited = TestClient(app)
            limited.__enter__()
            try:
                for _ in range(2):
                    attempt = limited.post("/v1/licences/activate", json={"key": "SYNAP-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "device_id_hash": _device(7), "os": "linux"})
                    assert attempt.status_code == 401
                blocked = limited.post("/v1/licences/activate", json={"key": "SYNAP-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "device_id_hash": _device(7), "os": "linux"})
                assert blocked.status_code == 429
                assert blocked.json()["error"]["code"] == "rate_limited"
            finally:
                limited.__exit__(None, None, None)
        finally:
            os.environ["ACTIVATION_LIMIT"] = "8"


def test_missing_webhook_secret_is_refused(monkeypatch):
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    with TestClient(app) as client:
        response = client.post("/v1/billing/stripe", content=b"{}", headers={"stripe-signature": "t=1,v1=00"})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "unconfigured"
