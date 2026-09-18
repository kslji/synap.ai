from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_HERE = Path(__file__).resolve().parent


def _project_root() -> Path:
    # Repo layout: apps/host → repo root with harness/. Zip layout: local-ai/host → unzipped folder.
    if len(_HERE.parents) > 1:
        repo = _HERE.parents[1]
        if (repo / "harness").is_dir():
            return repo
    return _HERE.parent


ROOT = _project_root()


def _prompt_path() -> Path:
    for path in (
        ROOT / "harness" / "prompts" / "system.md",
        ROOT / "system.md",
        _HERE.parent / "system.md",
    ):
        if path.is_file():
            return path
    return ROOT / "harness" / "prompts" / "system.md"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    host_bind: str = "127.0.0.1"
    host_port: int = 18765
    ollama_base: str = "http://127.0.0.1:11434"
    lmstudio_base: str = "http://127.0.0.1:1234"
    llamacpp_base: str = "http://127.0.0.1:8080"
    local_llm: str = "auto"
    default_model: str = "llama3.2:3b"
    keep_alive: str = "24h"
    num_ctx: int = 8192
    num_thread: int = 0
    cors_origins: str = (
        "http://127.0.0.1:3000,http://localhost:3000,"
        "http://127.0.0.1:18766,http://localhost:18766,"
        "https://synap.surf,https://www.synap.surf"
    )
    jwt_ttl_hours: int = 12
    chat_rate_per_minute: int = 30
    max_conversations: int = 50
    max_messages_per_conversation: int = 200
    max_trace_files: int = 80
    livekit_url: str = "ws://127.0.0.1:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"
    livekit_room: str = "local-ai"
    moss_project_id: str = ""
    moss_project_key: str = ""
    moss_index: str = "local-ai-vault"
    prompt_path: Path = _prompt_path()
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "local.ai@localhost"
    smtp_use_tls: bool = True
    local_ai_home: Path | None = None
    local_ai_data_dir: Path | None = None
    platform_data_dir: Path | None = None

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
