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

    # Store
    currency: str = "EGP"  # minor-unit exponent lives in core/money.py
    business_name: str = "The Baker"

    # Product photo storage: "local" (dev/tests) or "r2" (Cloudflare R2, S3-compatible)
    storage_backend: str = "local"
    upload_dir: str = "uploads"
    public_api_url: str = "http://localhost:8000"  # base for local /media URLs
    max_upload_bytes: int = 5 * 1024 * 1024
    r2_account_id: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: str | None = None
    r2_bucket: str | None = None
    r2_public_url: str | None = None  # public bucket URL or custom domain, no trailing slash

    # Load the demo catalog at startup (idempotent; only if the catalog is empty)
    seed_demo: bool = False

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
    def _check_storage(self) -> "Settings":
        if self.env == "production" and self.storage_backend != "r2":
            # Hosted disks are wiped on every deploy, so local storage would lose uploads.
            raise ValueError("Set STORAGE_BACKEND=r2 (and the R2_* variables) in production")
        if self.storage_backend == "r2":
            missing = [
                name
                for name in (
                    "r2_account_id",
                    "r2_access_key_id",
                    "r2_secret_access_key",
                    "r2_bucket",
                    "r2_public_url",
                )
                if not getattr(self, name)
            ]
            if missing:
                raise ValueError(
                    f"STORAGE_BACKEND=r2 requires: {', '.join(m.upper() for m in missing)}"
                )
        return self

    @model_validator(mode="after")
    def _check_production_secrets(self) -> "Settings":
        if self.env == "production" and self.jwt_secret == _INSECURE_JWT_SECRET:
            raise ValueError("JWT_SECRET must be set in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
