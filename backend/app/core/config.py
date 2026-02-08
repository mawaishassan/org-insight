"""Application configuration loaded from environment."""

from pathlib import Path
from functools import lru_cache

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

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]

    # Chat / NLP (OpenAI)
    OPENAI_API_KEY: str = ""
    CHAT_MODEL: str = "gpt-4o-mini"

    class Config:
        env_file = _ENV_FILE
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    """Return cached settings instance."""
    return Settings()
