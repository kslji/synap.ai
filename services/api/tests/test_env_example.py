"""Drift guard for the .env.example files (Item 10).

Every variable in deploy/.env.example must be a variable some piece of code
actually reads, and every variable the code reads must appear in the example.
Both real failure modes seen during the audit: documented vars nobody reads
(CHAT_PER_*, SURF_PACK_CONTENT_KEY) and code that silently reads an env var
no example mentions.

Scanners (deliberately conservative — name-based, no imports):
  * python_env_reads  os.environ["V"] / os.environ.get("V") / os.getenv("V")
                      and the ENV = os.environ alias used in services/api.
  * ts_env_reads      process.env.V and process.env["V"] — the one style the
                      code-pack scripts use.
  * compose_vars      ${V} / ${V:-default} shell interpolation in the compose
                      files. $${V} is a literal passed to the container shell
                      (healthchecks), not a reference, so it is excluded.
  * settings_fields   pydantic Settings field names, which pydantic-settings
                      reads from the environment by upper-cased name.

A tested allowlist covers names that are OS conventions, library/transport
internals, or names only ever written (env passed to subprocesses).
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

_NAME = r"([A-Z][A-Z0-9_]{2,})"
_READ = re.compile(r"""\bos\.(?:environ|getenv)|\bENV\b|\benviron\b|\bgetenv\b""")
# Accepted shapes: os.environ["V"] / os.environ.get("V") / os.getenv("V") and the
# ENV = os.environ alias (ENV["V"] / ENV.get("V")). Dynamic names are skipped.
_READS = re.compile(
    rf"""(?:os\.environ\s*(?:\[|\.get\()|os\.getenv\(|\b(?:ENV|environ)\s*(?:\[|\.get\())\s*['"]{_NAME}['"]"""
)
_TS_DOT = re.compile(rf"process\.env\.({_NAME})\b")
_TS_IDX = re.compile(r"process\.env\[['\"]([A-Z][A-Z0-9_]{2,})['\"]\]")
_COMPOSE = re.compile(rf"\$\{{({_NAME})(?::?-[^}}]*)?\}}")
_FIELD = re.compile(r"^ {4}([a-z][a-z0-9_]*)\s*:\s*[^=]+=", re.M)

# Names the scanners may hit that are not deployment config: OS directory/logins
# (APPDATA, XDG_DATA_HOME, USERPROFILE, …), interpreter/library switches the
# dependency code reads (PYTHON_DOTENV_DISABLED, SSL_CERT_FILE, watchfiles/
# uvicorn reload internals, PYDANTIC_*, …), shell/CI artifacts (PWD, SENDFILE,
# COMP_WORDS, FOO in sample code), and process names that only ever get
# *written* into a subprocess env by our code (GUNICORN_PID and friends).
# WEB_CONCURRENCY is the standard gunicorn knob (documented where its code lives).
ENV_ALLOWLIST = {
    "ACTUAL_BACKEND",
    "ANDROID_DATA",
    "ANDROID_ROOT",
    "APPDATA",
    "CI",
    "COMP_CWORD",
    "COMP_WORDS",
    "CONTAINER",
    "DATABRICKS_RUNTIME_VERSION",
    "DEPS",
    "EDITOR",
    "FORCE_COLOR",
    "FOO",
    "GIT_CONFIG",
    "GIT_EDITOR",
    "GUNICORN_CMD_ARGS",
    "GUNICORN_PID",
    "HOME",
    "HOSTNAME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PATH",
    "PIP_EXISTS_ACTION",
    "PIP_NO_INPUT",
    "PREFIX",
    "PROGRAMDATA",
    "PROGRAMFILES",
    "PROMPT",
    "PWD",
    "PYDANTIC_DISABLE_PLUGINS",
    "PYDANTIC_PRIVATE_ALLOW_UNHANDLED_SCHEMA_TYPES",
    "PYDANTIC_VALIDATE_CORE_SCHEMAS",
    "PYTHONASYNCIODEBUG",
    "PYTHONDEVMODE",
    "PYTHON_DOTENV_DISABLED",
    "PYTHONEXECUTABLE",
    "PYTHONFAULTHANDLER",
    "PYTHONHASHSEED",
    "PYTHONWARNINGS",
    "SENDFILE",
    "SHELL",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TEMPORARILY_DISABLE_PROTOBUF_VERSION_CHECK",
    "TERM",
    "TMP",
    "TMPDIR",
    "USER",
    "USERPROFILE",
    "VISUAL",
    "VIRTUAL_ENV",
    "WATCHFILES_CHANGES",
    "WATCHFILES_DEBUG",
    "WATCHFILES_FORCE_POLLING",
    "WATCHFILES_IGNORE_PERMISSION_DENIED",
    "WATCHFILES_POLL_DELAY_MS",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_DIRS",
    "XDG_DATA_HOME",
}


def _clean_rel(p: Path, root: Path) -> bool:
    try:
        rel = str(p.relative_to(root))
    except ValueError:
        rel = str(p)
    parts = rel.split("/")
    return not any(x in {".venv", "__pycache__", "node_modules", "dist", "out", "build"} for x in parts)


def python_env_reads(*roots: Path) -> set[str]:
    out: set[str] = set()
    for root in roots:
        for p in root.rglob("*.py"):
            if not _clean_rel(p, root):
                continue
            src = p.read_text(encoding="utf-8", errors="replace")
            if not _READ.search(src):
                continue
            for g in _READS.finditer(src):
                out.add(next(x for x in g.groups() if x))
    return out


def ts_env_reads(*roots: Path) -> set[str]:
    out: set[str] = set()
    for root in roots:
        for p in list(root.rglob("*.ts")) + list(root.rglob("*.mjs")):
            if not _clean_rel(p, root):
                continue
            src = p.read_text(encoding="utf-8", errors="replace")
            if "process.env" not in src:
                continue
            for regex in (_TS_DOT, _TS_IDX):
                for m in regex.finditer(src):
                    out.add(m.group(1))
    return out


def compose_vars(*files: Path) -> set[str]:
    out: set[str] = set()
    for f in files:
        src = f.read_text(encoding="utf-8")
        for m in _COMPOSE.finditer(src):
            out.add(m.group(1))
    return out


def settings_fields(config_py: Path) -> set[str]:
    """Field names of the pydantic Settings class (excludes model_config and
    @property helpers; skips entries whose default references another field —
    e.g. prompt_path, an internal file path, not operator config)."""
    src = config_py.read_text(encoding="utf-8")
    body = src.split("class Settings(BaseSettings)", 1)[1]
    out: set[str] = set()
    for m in _FIELD.finditer(body):
        name = m.group(1)
        if name.startswith("model_"):
            continue
        # Defaults computed from another module-level name (prompt_path =
        # _prompt_path()) are import-time internals, not operator config. Read
        # only this field's own line — an 80-char window would bleed into the
        # following fields (the moss_* group sits right after such a default).
        default_line = body[m.end() :].splitlines()[0] if m.end() < len(body) else ""
        if "_prompt_path" in default_line:
            continue
        out.add(name.upper())
    return out


def example_vars(path: Path) -> set[str]:
    out = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z][A-Z0-9_]{2,})=", line)
        if m:
            out.add(m.group(1))
    return out


# ---- the documented file and its reading code -----------------------------

DEPLOY_EXAMPLE = REPO / "deploy" / ".env.example"


def deploy_reads() -> set[str]:
    read = (
        python_env_reads(REPO / "services" / "api" / "app", REPO / "services" / "packs")
        | ts_env_reads(REPO / "scripts" / "code-pack-src")
        | compose_vars(REPO / "deploy" / "docker-compose.yml")
    )
    return read - ENV_ALLOWLIST


# ---- tests ----------------------------------------------------------------


def test_deploy_example_matches_code():
    read = deploy_reads()
    documented = example_vars(DEPLOY_EXAMPLE)
    assert read, "scanner found nothing — it regressed"
    missing = sorted(read - documented)
    extra = sorted(
        v
        for v in documented - read
        # Consumed inside a container image via env_file, not by our Python or a
        # compose ${} reference: the postgres bootstrap password, and the
        # uvicorn FORWARDED_ALLOW_IPS proxy-trust CIDR.
        if v not in {"POSTGRES_PASSWORD", "FORWARDED_ALLOW_IPS"}
    )
    assert not missing, f"code reads env vars missing from deploy/.env.example: {missing}"
    assert not extra, f"deploy/.env.example documents vars no code reads: {extra}"


def test_web_search_and_dev_open_vars_stayed_dropped():
    # Item 3 removed web search and SURF_DEV_OPEN; they must not creep back in.
    names = example_vars(DEPLOY_EXAMPLE)
    for ghost in ("SEARXNG_URL", "SEARXNG_SECRET", "SURF_DEV_OPEN", "SEARCH_PER_MIN", "SEARCH_PER_DAY"):
        assert ghost not in names, f"{ghost} must not return to {DEPLOY_EXAMPLE.name}"


def test_scanners_on_synthetic_files(tmp_path):
    # Guards the guards: each scanner must find a real read and ignore noise.
    py = tmp_path / "svc.py"
    py.write_text(
        "import os\nENV = os.environ\n"
        'A = ENV["MY_CONFIG_A"]\n'
        'B = os.environ.get("MY_CONFIG_B", "x")\n'
        'C = os.getenv("MY_CONFIG_C")\n'
        'D = os.environ.get(PREFIX + "NAME")\n'  # dynamic, ignored
        'E = model_config.get("NOT_ENV")\n'  # not an env read
    )
    assert python_env_reads(tmp_path) == {"MY_CONFIG_A", "MY_CONFIG_B", "MY_CONFIG_C"}
    ts = tmp_path / "sign.ts"
    ts.write_text('const a = process.env.MY_TS_A\nconst b = process.env["MY_TS_B"]\nconst c = process.env.dynamic\n')
    assert ts_env_reads(tmp_path) == {"MY_TS_A", "MY_TS_B"}
    yml = tmp_path / "compose.yml"
    yml.write_text(
        'services:\n  x:\n    image: ${MY_IMAGE_NAME:-tag}\n    test: ["CMD", "echo", "$${IN_CONTAINER_REF}"]\n'
    )
    # ${V} is a host reference; $${V} is passed through and resolved inside the
    # container, which gets its env from env_file — both count.
    assert compose_vars(yml) == {"MY_IMAGE_NAME", "IN_CONTAINER_REF"}
    cfg = tmp_path / "config.py"
    cfg.write_text(
        "from pydantic_settings import BaseSettings\n"
        "class Settings(BaseSettings):\n"
        "    model_config = {}\n"
        '    my_setting: str = "x"\n'
        "    other_number: int = 5\n"
        "    @property\ndef unused(self):\n        return 1\n"
    )
    assert settings_fields(cfg) == {"MY_SETTING", "OTHER_NUMBER"}
