from datetime import date, timedelta

from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.models import Claim

c = TestClient(app)


def _props(profile="stroller", **kw):
    fc = c.get("/layers/gaps", params={"profile": profile, **kw}).json()
    return {f["properties"]["id"]: f["properties"] for f in fc["features"]}


def test_counts_missing_unknown_and_fully_checked():
    p = _props()
    assert p["seg-ab"]["unknown_count"] == 0  # all three verified
    assert p["seg-cf"]["unknown_count"] == 1  # incline unknown
    assert p["seg-fd"]["unknown_count"] == 1  # width unknown
    # seg-be: step_count reported (not a gap), incline and width claims missing
    assert p["seg-be"]["unknown_count"] == 2
    assert p["seg-be"]["relevant_count"] == 3
    assert p["seg-gh"]["unknown_count"] == 3  # no claims at all


def test_stale_and_contested_count():
    w = state.get_ctx().world
    old = (date.today() - timedelta(days=400)).isoformat()
    w.edges["seg-ab"].claims["step_count"] = Claim(value=0, status="verified", verified_at=old)
    w.edges["seg-bc"].claims["incline_pct"] = Claim(value=2, status="stale")
    w.edges["seg-cd"].claims["width_m"] = Claim(value=1.5, status="contested")
    p = _props()
    assert (p["seg-ab"]["unknown_count"], p["seg-ab"]["stale_count"]) == (1, 1)
    assert (p["seg-bc"]["unknown_count"], p["seg-bc"]["stale_count"]) == (1, 1)
    assert (p["seg-cd"]["unknown_count"], p["seg-cd"]["stale_count"]) == (1, 0)


def test_relevant_attributes_follow_the_profile():
    assert _props("default")["seg-gh"]["relevant_count"] == 0  # no hard limits: nothing relevant
    assert _props("drive")["seg-gh"]["relevant_count"] == 0


def test_demand_sums_open_vrs_and_places_are_included():
    vrs = state.get_ctx().vrs
    vrs.request("seg-cf", "incline_pct", "unknown")
    vrs.request("seg-cf", "incline_pct", "unknown")
    vrs.request("seg-cf", "width_m", "unknown")
    p = _props()
    assert p["seg-cf"]["demand"] == 3
    assert p["seg-ab"]["demand"] == 0
    assert p["toilet-1"]["unknown_count"] == 1 and p["toilet-1"]["kind"] == "amenity"
    assert p["bench-1"]["unknown_count"] == 0
    assert p["park-b"]["relevant_count"] == 0


def test_no_verdict_words_in_payload():
    body = c.get("/layers/gaps", params={"profile": "wheelchair"}).text.lower()
    assert "status_for_profile" not in body
    assert "unsafe" not in body and "inaccessible" not in body


def test_etag_304_and_demand_invalidates():
    r = c.get("/layers/gaps", params={"profile": "stroller"})
    etag = r.headers["etag"]
    again = c.get("/layers/gaps", params={"profile": "stroller"}, headers={"If-None-Match": etag})
    assert again.status_code == 304
    state.get_ctx().vrs.request("seg-cf", "incline_pct", "unknown")
    after = c.get("/layers/gaps", params={"profile": "stroller"}, headers={"If-None-Match": etag})
    assert after.status_code == 200 and after.headers["etag"] != etag


def test_other_lenses_still_route():
    assert c.get("/layers/access").status_code == 200
    assert c.get("/layers/nope").status_code == 404
