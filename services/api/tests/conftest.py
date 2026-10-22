"""Pytest bootstrap for the Surf API test-suite.

The app reads configuration from ``os.environ`` at call time (not at import),
and ``main.py`` selects the in-memory LITE store via ``SURF_API_LITE`` /
``DATABASE_URL``. Historically every test module re-declared a small baseline
with ``os.environ.setdefault(...)`` at import time, so a new test that forgot
one line only failed when it ran before the alphabetically-earlier file that
happened to set it — order-dependent and easy to trip.

conftest.py is imported by pytest before any test module, so this is the single,
ordering-independent place for the baseline. Every value uses ``setdefault`` so a
deliberate CI override still wins, and individual tests can override via
``monkeypatch`` (which restores the environment afterwards). Tests that assert on
the *absence* of a value (e.g. the production startup guard) must pass an explicit
empty string rather than deleting the variable, because this file guarantees the
keys exist; the guard logic checks truthiness and does not use ``in``/``hasattr``.
"""
from __future__ import annotations

import os

# 39 chars so a length check (<32) treats it as a strong-enough dev secret.
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-ok")
os.environ.setdefault("JWT_AUDIENCE", "authenticated")
# Force the in-memory store so the suite never needs a real Postgres/Valkey.
os.environ.setdefault("SURF_API_LITE", "1")
# Console mailer: never attempt SMTP from tests.
os.environ.setdefault("MAIL_MODE", "console")
