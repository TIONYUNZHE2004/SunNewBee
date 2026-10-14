from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]


class AgentSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    openrouter_api_key: str = ""
    llm_provider: Literal["openrouter", "mock"] | None = None
    llm_model_default: str = "anthropic/claude-haiku-5.5"
    llm_model_escalate: str = "anthropic/claude-sonnet-5.5"
    llm_output_retries: int = 2

    @property
    def provider(self) -> str:
        if self.llm_provider:
            return self.llm_provider
        return "openrouter" if self.openrouter_api_key else "mock"
