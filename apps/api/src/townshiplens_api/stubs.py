import json
from pathlib import Path

FIXTURE = Path(__file__).resolve().parents[4] / "packages/spatial/tests/fixtures/tiny"


def read(rel: str) -> dict:
    return json.loads((FIXTURE / rel).read_text())
