from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://futures:futures@localhost:5432/futures_dashboard"
    api_cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    tqsdk_user: str | None = None
    tqsdk_password: str | None = None
    market_snapshot_dir: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


settings = Settings()
