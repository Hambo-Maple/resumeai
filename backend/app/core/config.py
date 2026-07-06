from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://resumeai:resumeai_dev_password@localhost:5432/resumeai_dev"
    openai_api_key: str | None = None
    openai_base_url: str | None = None
    llm_model: str = "gpt-4.1-mini"
    vision_model: str | None = None
    cors_origins_raw: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://0.0.0.0:5173,"
        "http://198.18.0.1:5173,"
        "http://172.25.61.19:5173"
    )
    prompt_root: str = "prompts"

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
