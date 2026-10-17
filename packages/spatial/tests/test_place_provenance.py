"""Place existence is evidence too; demo anchors never become surveyed amenities."""

import pytest
from townshiplens_spatial import routing, tools
from townshiplens_spatial.models import Claim
from townshiplens_spatial.vr_store import VerificationStore


@pytest.fixture
def ctx(world):
    world.places["toilet-1"].claims["existence"] = Claim(
        value=True, status="unknown", evidence_type="team_survey_placeholder"
    )
    return tools.Ctx(world=world, vrs=VerificationStore(":memory:"))


def test_search_and_details_preserve_existence_provenance(ctx):
    search = tools.find_place(ctx, "Park toilet")
    details = tools.get_place_details(ctx, "toilet-1")
    for result in (search, details):
        assert result.evidence[0].source_type == "team_survey_placeholder"
        assert result.evidence[0].status == "unknown"
        assert any("Demo value · not surveyed" in w for w in result.warnings)
    assert search.data[0]["demo_place"] is True
    assert details.data["claims"]["existence"]["evidence_type"] == "team_survey_placeholder"


def test_demo_toilet_cannot_be_an_unqualified_nearby_recommendation(ctx):
    result = tools.nearby_amenities(ctx, "park-b", "toilet", 300)
    row = next(x for x in result.data if x["id"] == "toilet-1")
    assert row["via_unverified"] is True
    assert row["demo_place"] is True
    assert row["source_label"] == "Demo value · not surveyed"
    assert result.evidence[0].source_type == "team_survey_placeholder"


def test_transport_provenance_does_not_change_route_evaluation(ctx):
    before = routing.plan_route(ctx.world, "park-b", "toilet-1", "default")
    after = tools.plan_route(ctx, "park-b", "toilet-1", "default", file_vrs=False)
    assert after.data["status"] == before.status
    assert [r["distance_m"] for r in after.data["routes"]] == [r.distance_m for r in before.routes]
    assert after.data["demo_evidence"] is True
    assert after.data["routes"][0]["demo_evidence"] is True
    assert after.data["place_provenance"][0]["demo_place"] is True
    assert any(
        e.element_id == "toilet-1" and e.source_type == "team_survey_placeholder"
        for e in after.evidence
    )


def test_surveyed_existence_is_not_permanently_marked_demo(ctx):
    ctx.world.places["toilet-1"].claims["existence"] = Claim(
        value=True, status="verified", evidence_type="field_survey", verified_at="2026-10-17"
    )
    result = tools.nearby_amenities(ctx, "park-b", "toilet", 300)
    assert result.data[0]["demo_place"] is False
    assert result.data[0]["via_unverified"] is False
    assert result.evidence[0].source_type == "field_survey"
    assert not any("Demo value" in w for w in result.warnings)
