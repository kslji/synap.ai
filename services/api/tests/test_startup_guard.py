"""Item 4: a production server refuses to start on missing or placeholder secrets."""
import pytest

from app.startup_guard import is_production, validate_production_config

_GOOD = "z" * 48  # long, no placeholder markers


def _run(monkeypatch, **overrides):
    for key in ("JWT_SECRET", "OPENROUTER_API_KEY", "MAIL_MODE", "SURF_ENV", "SURF_GATEWAY_OPTIONAL"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SURF_ENV", "production")
    for key, value in overrides.items():
        monkeypatch.setenv(key, value)
    validate_production_config()


def test_is_production_reads_surf_env(monkeypatch):
    monkeypatch.setenv("SURF_ENV", "Production")
    assert is_production() is True
    monkeypatch.setenv("SURF_ENV", "prod")
    assert is_production() is True
    monkeypatch.setenv("SURF_ENV", "development")
    assert is_production() is False
    monkeypatch.delenv("SURF_ENV")
    assert is_production() is False


def test_dev_and_test_envs_are_never_fatal(monkeypatch):
    # No SURF_ENV set: even a totally empty secret config boots (this is how tests run).
    monkeypatch.delenv("SURF_ENV", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    validate_production_config()


def test_missing_jwt_secret_refuses_start(monkeypatch):
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        _run(monkeypatch, JWT_SECRET="", OPENROUTER_API_KEY="or-key", MAIL_MODE="smtp")


def test_placeholder_jwt_secret_refuses_start(monkeypatch):
    with pytest.raises(RuntimeError, match="placeholder"):
        _run(monkeypatch, JWT_SECRET="dev-only-secret-change-me-at-least-32-bytes",
             OPENROUTER_API_KEY="or-key", MAIL_MODE="smtp")


def test_console_mail_refuses_start_even_with_good_secret(monkeypatch):
    # The dev fallback that returns dev_code/dev_key must not boot in production.
    with pytest.raises(RuntimeError, match="MAIL_MODE"):
        _run(monkeypatch, JWT_SECRET=_GOOD, OPENROUTER_API_KEY="or-key", MAIL_MODE="console")


def test_missing_gateway_key_refuses_start(monkeypatch):
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        _run(monkeypatch, JWT_SECRET=_GOOD, OPENROUTER_API_KEY="", MAIL_MODE="smtp")


def test_gateway_can_be_declared_optional(monkeypatch):
    _run(monkeypatch, JWT_SECRET=_GOOD, OPENROUTER_API_KEY="", MAIL_MODE="smtp",
         SURF_GATEWAY_OPTIONAL="1")


def test_valid_production_config_boots(monkeypatch):
    _run(monkeypatch, JWT_SECRET=_GOOD, OPENROUTER_API_KEY="or-key", MAIL_MODE="smtp")


def test_lifespan_refuses_boot_before_serving(monkeypatch):
    # The wiring in app.main must make a bad production config fatal at startup.
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.main import lifespan

    monkeypatch.setenv("SURF_ENV", "production")
    monkeypatch.setenv("SURF_API_LITE", "1")
    monkeypatch.setenv("MAIL_MODE", "smtp")
    monkeypatch.setenv("OPENROUTER_API_KEY", "or-key")
    monkeypatch.delenv("JWT_SECRET", raising=False)

    probe = FastAPI(lifespan=lifespan)

    @probe.get("/v1/ping")
    async def _ping():
        return {"pong": True}

    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        with TestClient(probe):
            pass  # unreachable: startup raises before any request is served


def test_dev_code_suppressed_in_production():
    # The source that mints the OTP response must gate dev_code behind non-production.
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text()
    assert "if not is_production() and os.environ.get(\"MAIL_MODE\"" in src
