"""Item 11: the repo-root VERSION file is the single source of truth.

apps/desktop (and, once the fork is committed, the surf-ide extension manifest)
must carry the same value. The API reports it from app/version.py, honouring an
APP_VERSION override for the container build (which has no repo root).
"""
import json
import re
from pathlib import Path

from app.version import app_version

REPO = Path(__file__).resolve().parents[3]
VERSION_FILE = REPO / "VERSION"


def _file_version() -> str:
    return VERSION_FILE.read_text(encoding="utf-8").strip()


def test_version_file_exists_and_is_semver():
    assert VERSION_FILE.is_file(), "repo-root VERSION file is the single source of truth"
    assert re.fullmatch(r"\d+\.\d+\.\d+", _file_version()), _file_version()


def test_app_version_follows_the_file_when_unset(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert app_version() == _file_version()


def test_app_version_honours_env_override(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "9.9.9")
    assert app_version() == "9.9.9"


def test_desktop_manifest_matches_the_source_of_truth(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    pkg = json.loads((REPO / "apps" / "desktop" / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == app_version()
