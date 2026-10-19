"""Route parity (spec 2026-10-19 resident journey AC-A5): display work (clipping the stylised city
to the Elmina boundary, the diorama slab) never changes routing. `/routes` JSON for the §2 route
(osm-way-909868201 -> park-b, older_adult_rest) on the Elmina seed must equal the snapshot taken at
the A-T4 base commit (92e5bd0). Regenerate only for a deliberate routing or data change:
`TL_WRITE_ROUTE_SNAPSHOT=1 uv run pytest apps/api/tests/test_route_parity.py`.
"""

import json
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

SEED = Path(__file__).resolve().parents[3] / "data/seed/elmina"
SNAPSHOT = Path(__file__).parent / "snapshots" / "route_s2_older_adult_rest.json"
BODY = {"from": "osm-way-909868201", "to": "park-b", "profile": "older_adult_rest"}


@pytest.fixture
def seed(monkeypatch):
    monkeypatch.setenv("TL_DATA_DIR", str(SEED))
    from townshiplens_api import state

    state.reset()
    yield
    state.reset()


def test_s2_route_json_is_unchanged_by_display_work(seed):
    from townshiplens_api.main import app

    r = TestClient(app).post("/routes", json=BODY)
    assert r.status_code == 200, r.text
    got = r.json()
    if os.environ.get("TL_WRITE_ROUTE_SNAPSHOT") == "1":
        SNAPSHOT.write_text(json.dumps(got, indent=2, sort_keys=True) + "\n", newline="\n")
    assert got == json.loads(SNAPSHOT.read_text(encoding="utf-8"))
