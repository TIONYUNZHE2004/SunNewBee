from pathlib import Path

import pytest

TINY = Path(__file__).resolve().parents[3] / "packages/spatial/tests/fixtures/tiny"


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setenv("TL_DATA_DIR", str(TINY))
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/t.db")
    monkeypatch.setenv("STAFF_TOKEN", "test-token")
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    from townshiplens_api import state

    state.reset()
    yield
