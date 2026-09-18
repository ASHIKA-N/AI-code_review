from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: Literal["development", "production"] = "development"
    ai_provider: Literal["mock"] = "mock"
    verireview_api_key: SecretStr = SecretStr("")

    @model_validator(mode="after")
    def production_requires_auth(self) -> "Settings":
        if self.app_env == "production" and not self.verireview_api_key.get_secret_value():
            raise ValueError("VERIREVIEW_API_KEY is required in production")
        return self
