from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://autoreply:autoreply@127.0.0.1:5432/autoreply"

    # Signs login JWTs. Rotating it logs everyone out.
    secret_key: str
    # Encrypts GetGabs API keys at rest. Rotating it makes stored keys unreadable.
    encryption_key: str
    access_token_expire_minutes: int = 60 * 24 * 7

    # Public URL of this API — used to build webhook URLs and media links
    # that WhatsApp downloads.
    public_base_url: str = "http://localhost:8010"
    # Comma-separated list of frontend origins allowed by CORS.
    cors_origins: str = "http://localhost:3000"

    media_dir: str = "/data/media"
    max_upload_mb: int = 100

    getgabs_base_url: str = "https://app.getgabs.com"

    # When both are set, this user is created on startup if it doesn't exist.
    admin_email: str | None = None
    admin_password: str | None = None
    admin_name: str = "Admin"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
