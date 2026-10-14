from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]
TINY_FIXTURE = ROOT / "packages/spatial/tests/fixtures/tiny"
DEFAULT_STAFF_TOKEN = "change-me"


class ApiSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    tl_data_dir: Path = ROOT / "data/seed/elmina"
    database_url: str = f"sqlite:///{ROOT}/.data/townshiplens.db"
    staff_token: str = DEFAULT_STAFF_TOKEN
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
