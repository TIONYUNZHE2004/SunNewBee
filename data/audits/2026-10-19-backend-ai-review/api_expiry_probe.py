# ruff: noqa: E402
"""Clock-controlled FastAPI probe: compare cached and freshly evaluated verification status."""

import json
import sys
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
from fastapi.testclient import TestClient
from townshiplens_api import geojson, state
from townshiplens_api.main import app
from townshiplens_spatial import access, evaluate, tools
from townshiplens_spatial.vr_store import VerificationStore
from townshiplens_spatial.world import load_world

w = load_world(ROOT / "packages/spatial/tests/fixtures/tiny")
ctx = tools.Ctx(w, VerificationStore(":memory:"))
for claim in w.edges["seg-ab"].claims.values():
    claim.status = "verified"
    claim.evidence_type = "field_survey"
    claim.verified_by = "staff"
    claim.verified_at = "2026-10-18"
    claim.ttl_days = 0


class Day1(date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 18)


class Day2(date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 19)


def status(d):
    return next(
        f["properties"]["status_for_profile"]
        for f in d["features"]
        if f["properties"]["id"] == "seg-ab"
    )


geojson.clear_cache()
with patch.object(state, "get_ctx", return_value=ctx):
    client = TestClient(app)
    with patch.object(access, "date", Day1), patch.object(evaluate, "date", Day1):
        first = client.get("/layers/access?profile=wheelchair")
    with patch.object(access, "date", Day2), patch.object(evaluate, "date", Day2):
        cached = client.get("/layers/access?profile=wheelchair")
        uncached = geojson._layer(w, "access", "wheelchair")
        conditional = client.get(
            "/layers/access?profile=wheelchair", headers={"If-None-Match": first.headers["etag"]}
        )
    result = {
        "day1_layer": status(first.json()),
        "day2_cached_layer": status(cached.json()),
        "day2_uncached_layer": status(uncached),
        "day2_conditional_http": conditional.status_code,
        "etag_unchanged": first.headers["etag"] == cached.headers["etag"],
    }
print(json.dumps(result))
Path("/tmp/tl-mean-audit-expiry.json").write_text(json.dumps(result, indent=2) + "\n")
