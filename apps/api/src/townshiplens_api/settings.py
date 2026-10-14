from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]
TINY_FIXTURE = ROOT / "packages/spatial/tests/fixtures/tiny"


class ApiSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    tl_data_dir: Path = ROOT / "data/seed/elmina"
    database_url: str = f"sqlite:///{ROOT}/.data/townshiplens.db"
    staff_token: str = "change-me"
