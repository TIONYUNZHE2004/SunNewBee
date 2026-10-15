from datetime import date, timedelta

from fastapi.testclient import TestClient
from townshiplens_api import state
from townshiplens_api.main import app
from townshiplens_spatial.models import Claim

c = TestClient(app)


def _surveyed():
    """The tiny fixture's verified claims are demo values; most tests here are about the
    verified-claim semantics, so give them real field-survey evidence."""
    w = state.get_ctx().world
    for e in w.edges.values():
        e.claims = {
            a: cl.model_copy(update={"evidence_type": "field_survey"})
            if cl.evidence_type == "team_survey_placeholder"
            else cl
            for a, cl in e.claims.items()
        }
    for p in w.places.values():
        p.claims = {
            a: cl.model_copy(update={"evidence_type": "field_survey"})
            if cl.evidence_type == "team_survey_placeholder"
            else cl
            for a, cl in p.claims.items()
        }


def _props(profile="stroller", surveyed=True, **kw):
    if surveyed:
        _surveyed()
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
    assert p["seg-be"]["reported_count"] == 0  # the reported steps break the limit: a barrier
    assert p["seg-be"]["unknown_attributes"] == ["incline_pct", "width_m"]
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


def test_reported_counts_as_a_gap_and_is_counted_separately():
    w = state.get_ctx().world
    w.edges["seg-ab"].claims["width_m"] = Claim(value=1.5, status="reported")
    p = _props()["seg-ab"]
    assert (p["unknown_count"], p["reported_count"]) == (1, 1)
    assert p["unknown_attributes"] == ["width_m"]


def test_journey_impact_comes_from_the_latest_sim_run(run_sim):
    assert all(p["journey_impact"] == 0 for p in _props().values())
    run = run_sim({})
    ranked = {(g["element_id"]) for g in run["gaps"] if "stroller" in g["affected_profiles"]}
    assert ranked, "tiny fixture should yield at least one ranked gap"
    p = _props("stroller")
    assert {i for i, v in p.items() if v["journey_impact"] > 0} == ranked
    # a new run changes the validator, so a cached 304 is not served
    assert c.get("/layers/gaps", params={"profile": "stroller"}).headers["etag"]


def test_response_is_typed_in_openapi():
    schema = c.get("/openapi.json").json()["components"]["schemas"]
    assert {"reported_count", "journey_impact", "unknown_count"} <= set(
        schema["GapProperties"]["properties"]
    )


def test_default_profile_sees_major_road_sidewalk_as_relevant():
    state.get_ctx().world.edges["seg-gh"].type = "major_road"
    assert _props("default")["seg-gh"]["relevant_count"] == 1


def test_demo_values_are_a_gap_not_fully_checked():
    """Task 55 (R33): verified claims on team_survey_placeholder evidence are "not yet surveyed"."""
    p = _props(surveyed=False)["seg-ab"]  # all three verified, all demo values
    assert p["relevant_count"] == 3
    assert p["unknown_count"] == 3 and p["demo_count"] == 3
    assert p["unknown_attributes"] == ["step_count", "incline_pct", "width_m"]
    real = _props()["seg-ab"]  # same edge once surveyed for real
    assert real["unknown_count"] == 0 and real["demo_count"] == 0


def test_demo_count_is_zero_without_demo_values():
    assert all(p["demo_count"] == 0 for p in _props().values())


def test_no_fully_checked_edge_rests_on_demo_values():
    state.get_ctx()  # tiny world
    w = state.get_ctx().world
    for prof in ("stroller", "wheelchair", "older_adult_rest"):
        for pid, p in _props(prof, surveyed=False).items():
            e = w.edges.get(pid)
            if e is None or p["relevant_count"] == 0 or p["unknown_count"] > 0:
                continue
            assert not any(
                cl.evidence_type == "team_survey_placeholder" for cl in e.claims.values()
            )


def test_demo_count_is_typed_in_openapi():
    schema = c.get("/openapi.json").json()["components"]["schemas"]
    assert "demo_count" in schema["GapProperties"]["properties"]


def test_seed_probe_no_fully_checked_edge_rests_on_demo_values(monkeypatch):
    """On the committed Elmina seed (Task 55 I2): 0 "Fully checked" edges rest on demo values."""
    from pathlib import Path

    seed = Path(__file__).resolve().parents[3] / "data/seed/elmina"
    if not (seed / "site.json").exists():
        import pytest

        pytest.skip("seed not present")
    monkeypatch.setenv("TL_DATA_DIR", str(seed))
    state.reset()
    w = state.get_ctx().world
    checked_on_demo = 0
    for prof in ("stroller", "wheelchair", "older_adult_rest"):
        for pid, p in _props(prof, surveyed=False).items():
            e = w.edges.get(pid)
            if e is None or p["relevant_count"] == 0 or p["unknown_count"] > 0:
                continue
            if any(cl.evidence_type == "team_survey_placeholder" for cl in e.claims.values()):
                checked_on_demo += 1
    assert checked_on_demo == 0
