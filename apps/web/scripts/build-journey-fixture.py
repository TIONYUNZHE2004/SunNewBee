"""Regenerate apps/web/src/features/journey/fixtures/demoPlan.json from the real backend.

The §2 demo route of the resident-journey spec (Harmoni 1 -> Lakeside Mall Car Park B, older adult
with a walker, 09:00), planned by POST /journeys on the Elmina seed. Mock-free: no LLM is involved.

    uv run python apps/web/scripts/build-journey-fixture.py
"""

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SEED = ROOT / "data/seed/elmina"
OUT = ROOT / "apps/web/src/features/journey/fixtures/demoPlan.json"
BODY = {
    "from_id": "osm-way-909868201",
    "to_id": "park-b",
    "profile": "older_adult_rest",
    "start_time": "09:00",
}


def main() -> int:
    if not (SEED / "site.json").exists():
        print(f"Elmina seed not found at {SEED}", file=sys.stderr)
        return 1
    # A throwaway store: POST /journeys files no verification requests, but keep .data/ untouched.
    # ignore_cleanup_errors: on Windows the API may still hold the SQLite file open at exit.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
        return _build(Path(tmp) / "fixture.db")


def _build(db: Path) -> int:
    os.environ["TL_DATA_DIR"] = str(SEED)
    os.environ["DATABASE_URL"] = f"sqlite:///{db}"
    from fastapi.testclient import TestClient
    from townshiplens_api import state
    from townshiplens_api.main import app

    state.reset()
    with TestClient(app) as client:
        r = client.post("/journeys", json=BODY)
    state.reset()
    if r.status_code != 200:
        print(f"POST /journeys -> {r.status_code}: {r.text}", file=sys.stderr)
        return 1
    OUT.write_text(json.dumps(r.json(), indent=1, ensure_ascii=False) + "\n", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(r.json()['events'])} events")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
