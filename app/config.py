from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)
    app_env: Literal["local", "test", "production"] = "local"
    database_url: SecretStr = SecretStr("sqlite:///./teachease.db")
    supabase_url: str = ""
    supabase_publishable_key: SecretStr = SecretStr("")
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = ""
    cors_origins: list[str] = []
    require_mfa: bool = True
    ai_requests_per_minute: int = Field(default=10, ge=1, le=1000)
    ai_timeout_seconds: int = Field(default=45, ge=1, le=120)
    max_concurrent_ocr: int = Field(default=2, ge=1, le=4)
    max_image_bytes: int = Field(default=5 * 1024 * 1024, ge=1024, le=10 * 1024 * 1024)
    max_image_pixels: int = Field(default=20_000_000, ge=1000, le=40_000_000)
    max_request_bytes: int = Field(default=6 * 1024 * 1024, ge=1024, le=12 * 1024 * 1024)
    db_pool_size: int = Field(default=5, ge=1, le=20)
    db_max_overflow: int = Field(default=5, ge=0, le=20)

    @model_validator(mode="after")
    def secure_production(self):
        if "*" in self.cors_origins:
            raise ValueError("Use explicit CORS origins")
        if self.app_env == "production":
            if not self.database_url.get_secret_value().startswith("postgresql+psycopg://"):
                raise ValueError("Production requires PostgreSQL with the restricted TeachEase login")
            if (
                not self.supabase_url.startswith("https://")
                or not self.supabase_publishable_key.get_secret_value()
            ):
                raise ValueError("Production requires HTTPS Supabase Auth configuration")
            if not self.require_mfa:
                raise ValueError("Production requires Supabase MFA (aal2)")
        return self


@lru_cache
def get_settings():
    return Settings()
