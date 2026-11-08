from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_JWT_SECRET = "change-me-in-production"


def _strip_scheme(url: str) -> str:
    """Return the part of a database URL after '://' so we can set our own driver."""
    return url.split("://", 1)[1] if "://" in url else url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"  # development | test | production

    # Database (Railway provides DATABASE_URL as postgresql://...)
    database_url: str = "postgresql://baker:baker@localhost:5432/baker"
    db_pool_size: int = 5
    db_max_overflow: int = 5

    # Auth
    jwt_secret: str = _INSECURE_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    password_reset_minutes: int = 30

    # URLs / CORS
    frontend_url: str = "http://localhost:5173"
    cors_origins: str = "http://localhost:5173"  # comma separated
    cors_origin_regex: str | None = None  # e.g. https://the-baker-.*\.vercel\.app

    # First owner account, created at startup if no owner exists
    first_owner_email: str | None = None
    first_owner_password: str | None = None
    first_owner_name: str = "Owner"

    rate_limit_enabled: bool = True

    @property
    def async_database_url(self) -> str:
        return "postgresql+asyncpg://" + _strip_scheme(self.database_url)

    @property
    def sync_database_url(self) -> str:
        return "postgresql+psycopg://" + _strip_scheme(self.database_url)

    @property
    def cors_origin_list(self) -> list[str]:
        # Tolerate quotes, spaces and trailing slashes pasted into a hosting dashboard.
        cleaned = (o.strip().strip("\"'").strip().rstrip("/") for o in self.cors_origins.split(","))
        return [o for o in cleaned if o]

    @model_validator(mode="after")
    def _check_production_secrets(self) -> "Settings":
        if self.env == "production" and self.jwt_secret == _INSECURE_JWT_SECRET:
            raise ValueError("JWT_SECRET must be set in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
