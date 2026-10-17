from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]


class AgentSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    openrouter_api_key: str = ""
    llm_provider: Literal["openrouter", "mock"] | None = None
    llm_model_default: str = "anthropic/claude-haiku-5.5"
    llm_model_escalate: str = "anthropic/claude-sonnet-5.5"
    # Backup model when the default one errors (provider down, rate limit). Empty: no backup.
    llm_model_fallback: str = ""
    # After the validator sends an answer back, retry on llm_model_escalate (costs more).
    llm_escalate_on_rewrite: bool = False
    # Elmina Day spotlight residents (Cycle 11): a cheap model, low reasoning effort.
    llm_model_sim: str = "openai/gpt-6-luna"  # benchmark: evals/results/*sim-model-bench.json
    llm_sim_reasoning: str = "low"
    llm_output_retries: int = 2
    # Most model requests one turn may make (tool steps + answer + rewrites); the library default
    # is 50. Past the cap the turn ends with the template answer (audit F5).
    llm_request_limit: int = 12
    turn_timeout_s: float = 60.0
    demo_mode: bool = False
    demo_dir: Path = ROOT / "data/demo"

    @field_validator("llm_provider", mode="before")
    @classmethod
    def _empty_provider_is_default(cls, v):
        """`LLM_PROVIDER=` (as in .env.example) means unset: mock without a key, else openrouter."""
        return None if isinstance(v, str) and not v.strip() else v

    @property
    def provider(self) -> str:
        if self.llm_provider:
            return self.llm_provider
        return "openrouter" if self.openrouter_api_key else "mock"
