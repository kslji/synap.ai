"""Stable JSON error shape. `detail` stays a string or validation list so the site parser keeps working."""

from __future__ import annotations

STATUS_CODES = {
    400: "invalid_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    423: "locked",
    429: "rate_limited",
    500: "internal_error",
    501: "not_implemented",
    502: "bad_gateway",
    503: "unavailable",
}

RATE_LIMIT_DETAIL = "Too many attempts. Wait a few minutes and try again."


def code_for(status: int, explicit: str | None = None) -> str:
    if explicit:
        return explicit
    return STATUS_CODES.get(status, "error")


def error_payload(detail: object, code: str, request_id: str | None = None) -> dict:
    body: dict = {"detail": detail, "code": code}
    if request_id:
        body["request_id"] = request_id
    return body
