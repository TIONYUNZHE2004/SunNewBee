from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[4]
TINY_FIXTURE = ROOT / "packages/spatial/tests/fixtures/tiny"
DEFAULT_STAFF_TOKEN = "change-me"


class ApiSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    tl_data_dir: Path = ROOT / "data/seed/elmina"
    database_url: str | None = None
    staff_token: str = DEFAULT_STAFF_TOKEN
    evidence_dir: Path = ROOT / ".data" / "evidence"
    sim_time_budget_s: float = 600.0  # a simulation run is stopped as `timeout` after this long
    # Fill the world-model caches for the screens' default requests in the background (Cycle 9).
    warm_world_model: bool = True
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    def db_path(self, site_id: str) -> str:
        """Explicit DATABASE_URL wins; otherwise one file per world so seeds never share rows."""
        if self.database_url:
            path = Path(self.database_url.removeprefix("sqlite:///"))
            # A relative path means the repo root, not the directory the API happens to start in.
            return str(path if path.is_absolute() else ROOT / path)
        return str(ROOT / ".data" / f"{site_id}.db")
