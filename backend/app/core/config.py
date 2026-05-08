"""Application configuration loaded from environment."""

import json
from pathlib import Path
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings

# Load .env from backend directory so it works when running from project root or backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    """Application settings with validation."""

    # App
    APP_NAME: str = "VC KPI MIS"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/uni_kpi_mis"

    # JWT
    JWT_SECRET_KEY: str = "change-me-in-production-use-long-random-string"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS (localhost + 127.0.0.1; 3000/3001 for Next.js when the default port is taken)
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors_origins(cls, v):
        # Allow env var formats:
        # - JSON list: ["http://localhost:3001", ...]
        # - Comma-separated: http://localhost:3001,http://127.0.0.1:3001
        if v is None:
            return v
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return []
            if s.startswith("["):
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, list):
                        return [str(x).strip() for x in parsed if str(x).strip()]
                except Exception:
                    pass
            return [x.strip() for x in s.split(",") if x.strip()]
        return v

    # Local storage (when storage_type=local)
    UPLOAD_BASE_PATH: str = "uploads"

    # Chat / NLP (OpenAI)
    OPENAI_API_KEY: str = ""
    CHAT_MODEL: str = "gpt-4o-mini"

    # Reporting (optional dev knobs)
    REPORT_PREVIEW_PROFILE: bool = False
    REPORT_DATA_CACHE_SECONDS: float = 0.0

    class Config:
        env_file = _ENV_FILE
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
